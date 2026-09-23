// ComposeMessageDialog — Dialog for composing and sending private messages
// Features user search autocomplete for recipient selection

"use client";

import { Combobox } from "@base-ui/react/combobox";
import { AlertCircle, Loader2, Send, User, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { handleSubmitShortcut } from "@/lib/composer-keyboard";
import { cn } from "@/lib/utils";
import {
	ApiError,
	type SendMessagePayload,
	searchUsers,
	sendMessage,
	type UserSearchResult,
} from "@/viewmodels/forum/messages";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { useForumToast } from "./forum-toast";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ComposeMessageDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pre-selected recipient (from URL ?to=123 or profile link) */
	initialRecipient?: { id: number; username: string };
	/** Callback when message is sent successfully */
	onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// User Search Autocomplete
// ---------------------------------------------------------------------------

interface UserAutocompleteProps {
	value: string;
	onChange: (value: string) => void;
	selectedUser: UserSearchResult | null;
	onSelectUser: (user: UserSearchResult | null) => void;
	disabled?: boolean;
	invalid?: boolean;
	describedBy?: string;
}

function UserAutocomplete({
	value,
	onChange,
	selectedUser,
	onSelectUser,
	disabled,
	invalid,
	describedBy,
}: UserAutocompleteProps) {
	const [results, setResults] = useState<UserSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [showDropdown, setShowDropdown] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [searchAttempt, setSearchAttempt] = useState(0);

	// Debounced search
	// biome-ignore lint/correctness/useExhaustiveDependencies: searchAttempt retries the same query after a failed request.
	useEffect(() => {
		setResults([]);
		setSearchError(null);
		if (value.trim().length < 2 || selectedUser || disabled) {
			setIsSearching(false);
			if (selectedUser || disabled) setShowDropdown(false);
			return;
		}

		let cancelled = false;
		setIsSearching(true);
		const timeout = setTimeout(async () => {
			try {
				const users = await searchUsers(value.trim());
				if (cancelled) return;
				setResults(users);
				setShowDropdown(true);
			} catch {
				if (cancelled) return;
				setSearchError("收信人搜索失败");
				setShowDropdown(true);
			} finally {
				if (!cancelled) setIsSearching(false);
			}
		}, 300);

		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [value, selectedUser, disabled, searchAttempt]);

	return (
		<Combobox.Root
			items={results}
			filter={null}
			value={selectedUser}
			inputValue={value}
			open={showDropdown && !disabled}
			onOpenChange={setShowDropdown}
			disabled={disabled}
			autoHighlight
			itemToStringLabel={(user) => user.username}
			isItemEqualToValue={(a, b) => a.id === b.id}
			onValueChange={(user) => {
				onSelectUser(user);
				onChange(user?.username ?? "");
			}}
			onInputValueChange={(query) => {
				onChange(query);
				if (selectedUser && query !== selectedUser.username) onSelectUser(null);
			}}
		>
			<div className="relative">
				<Combobox.Input
					render={<Input />}
					id="recipient"
					placeholder="输入用户名搜索..."
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
					aria-busy={isSearching}
					className={cn("h-10 pr-10", selectedUser && "text-primary font-medium")}
				/>
				{isSearching && (
					<Loader2
						className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
				)}
				{selectedUser && !isSearching && (
					<Combobox.Clear
						render={<Button variant="ghost" size="icon-sm" />}
						disabled={disabled}
						aria-label="清除收信人"
						className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
					>
						<X className="h-4 w-4" />
					</Combobox.Clear>
				)}
			</div>

			<Combobox.Portal>
				<Combobox.Positioner sideOffset={6} className="z-50">
					<Combobox.Popup className="max-h-64 w-(--anchor-width) overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg outline-none">
						<Combobox.Empty className="px-3 py-3 text-sm text-muted-foreground">
							{searchError ? (
								<div role="alert" className="flex items-center justify-between gap-2">
									<span>{searchError}</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setSearchAttempt((attempt) => attempt + 1)}
									>
										重试搜索
									</Button>
								</div>
							) : isSearching ? (
								"正在搜索…"
							) : value.trim().length < 2 ? (
								"请输入至少两个字"
							) : (
								"没有找到匹配的用户"
							)}
						</Combobox.Empty>
						<Combobox.List aria-label="收信人搜索结果">
							{(user: UserSearchResult) => (
								<Combobox.Item
									key={user.id}
									value={user}
									className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
								>
									<User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span className="min-w-0 break-words">{user.username}</span>
								</Combobox.Item>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	);
}

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

export function ComposeMessageDialog({
	open,
	onOpenChange,
	initialRecipient,
	onSuccess,
}: ComposeMessageDialogProps) {
	const toast = useForumToast();
	const formErrorId = useId();

	// Form state
	const [recipientQuery, setRecipientQuery] = useState("");
	const [selectedRecipient, setSelectedRecipient] = useState<UserSearchResult | null>(null);
	const [subject, setSubject] = useState("");
	const [content, setContent] = useState("");

	// UI state
	const [isSending, setIsSending] = useState(false);
	const sendingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);

	// Initialize with pre-selected recipient
	useEffect(() => {
		if (open && initialRecipient) {
			setRecipientQuery(initialRecipient.username);
			setSelectedRecipient({
				id: initialRecipient.id,
				username: initialRecipient.username,
			});
		}
	}, [open, initialRecipient]);

	// Write-gate check when dialog opens — block compose if user can't write
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		writeGatePreflight(null, "message").then((blocked) => {
			if (!cancelled && blocked) onOpenChange(false);
		});
		return () => {
			cancelled = true;
		};
	}, [open, onOpenChange]);

	// Reset form when dialog closes
	useEffect(() => {
		if (!open) {
			setRecipientQuery("");
			setSelectedRecipient(null);
			setSubject("");
			setContent("");
			setError(null);
		}
	}, [open]);

	const handleSubmit = useCallback(async () => {
		if (sendingRef.current) return;
		if (!selectedRecipient) {
			setError("请选择收信人");
			return;
		}

		if (!content.trim()) {
			setError("请输入站内信内容");
			return;
		}

		sendingRef.current = true;
		setIsSending(true);
		setError(null);

		try {
			const payload: SendMessagePayload = {
				receiverId: selectedRecipient.id,
				content: content.trim(),
			};
			if (subject.trim()) {
				payload.subject = subject.trim();
			}

			await sendMessage(payload);
			onOpenChange(false);
			onSuccess?.();
			toast.success("站内信已发送");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "发送失败，请重试";
			setError(message);
			toast.error({ title: "发送失败", description: message });
		} finally {
			sendingRef.current = false;
			setIsSending(false);
		}
	}, [selectedRecipient, subject, content, onOpenChange, onSuccess, toast]);

	const recipientInvalid = error === "请选择收信人";
	const contentInvalid = error !== null && !recipientInvalid;

	return (
		<Dialog open={open} onOpenChange={(next) => !sendingRef.current && onOpenChange(next)}>
			<DialogContent
				className="flex flex-col overflow-hidden sm:max-w-xl"
				showCloseButton={!isSending}
				aria-busy={isSending}
				onKeyDownCapture={(event) => {
					handleSubmitShortcut(event.nativeEvent, () => {
						void handleSubmit();
					});
				}}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Send className="h-5 w-5 text-primary" aria-hidden="true" />
						写站内信
					</DialogTitle>
					<DialogDescription>与社区成员一对一交流，已发送的消息可在发件箱查看。</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 overflow-y-auto overscroll-contain grid gap-4 py-2">
					{error && (
						<div
							id={formErrorId}
							role="alert"
							className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive"
						>
							<AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
							<span>{error}</span>
						</div>
					)}

					<div className="grid gap-2">
						<Label htmlFor="recipient">收信人</Label>
						<UserAutocomplete
							value={recipientQuery}
							onChange={setRecipientQuery}
							selectedUser={selectedRecipient}
							onSelectUser={setSelectedRecipient}
							disabled={isSending}
							invalid={recipientInvalid}
							describedBy={recipientInvalid ? formErrorId : undefined}
						/>
					</div>

					{/* Subject */}
					<div className="grid gap-2">
						<Label htmlFor="subject">
							主题 <span className="text-muted-foreground">(可选)</span>
						</Label>
						<Input
							id="subject"
							className="h-10"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							placeholder="主题..."
							maxLength={100}
							disabled={isSending}
						/>
					</div>

					{/* Content */}
					<div className="grid gap-2">
						<Label htmlFor="content">内容</Label>
						<Textarea
							id="content"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder="输入站内信内容..."
							rows={8}
							maxLength={10000}
							disabled={isSending}
							aria-invalid={contentInvalid || undefined}
							aria-describedby={contentInvalid ? formErrorId : undefined}
							aria-keyshortcuts="Control+Enter Meta+Enter"
							className="resize-none leading-7"
						/>
						<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
							<span>Enter 换行，Ctrl/⌘+Enter 发送</span>
							<span>{content.length}/10000</span>
						</div>
					</div>
				</div>

				<DialogFooter>
					<DialogClose render={<Button variant="outline" disabled={isSending} />}>取消</DialogClose>
					<Button onClick={() => void handleSubmit()} disabled={isSending} aria-busy={isSending}>
						{isSending ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />
								发送中...
							</>
						) : (
							<>
								<Send className="h-4 w-4 mr-1" aria-hidden="true" />
								发送
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
