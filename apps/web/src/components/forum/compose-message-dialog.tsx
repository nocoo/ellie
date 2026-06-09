// ComposeMessageDialog — Dialog for composing and sending private messages
// Features user search autocomplete for recipient selection

"use client";

import { AlertCircle, Loader2, Send, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
}

function UserAutocomplete({
	value,
	onChange,
	selectedUser,
	onSelectUser,
	disabled,
}: UserAutocompleteProps) {
	const [results, setResults] = useState<UserSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [showDropdown, setShowDropdown] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced search
	useEffect(() => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		if (!value || value.length < 2 || selectedUser) {
			setResults([]);
			setShowDropdown(false);
			return;
		}

		setIsSearching(true);
		searchTimeoutRef.current = setTimeout(async () => {
			try {
				const users = await searchUsers(value);
				setResults(users);
				setShowDropdown(users.length > 0);
			} catch {
				setResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 300);

		return () => {
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current);
			}
		};
	}, [value, selectedUser]);

	// Close dropdown on outside click
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node) &&
				inputRef.current &&
				!inputRef.current.contains(event.target as Node)
			) {
				setShowDropdown(false);
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleSelect = (user: UserSearchResult) => {
		onSelectUser(user);
		onChange(user.username);
		setShowDropdown(false);
	};

	const handleClear = () => {
		onSelectUser(null);
		onChange("");
		inputRef.current?.focus();
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange(e.target.value);
		// If user edits after selection, clear the selection
		if (selectedUser && e.target.value !== selectedUser.username) {
			onSelectUser(null);
		}
	};

	return (
		<div className="relative">
			<div className="relative">
				<Input
					ref={inputRef}
					value={value}
					onChange={handleInputChange}
					placeholder="输入用户名搜索..."
					disabled={disabled}
					className={cn("pr-8", selectedUser && "text-primary font-medium")}
					onFocus={() => {
						if (results.length > 0 && !selectedUser) {
							setShowDropdown(true);
						}
					}}
				/>
				{isSearching && (
					<Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
				)}
				{selectedUser && !isSearching && (
					<button
						type="button"
						onClick={handleClear}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				)}
			</div>

			{showDropdown && results.length > 0 && (
				<div
					ref={dropdownRef}
					className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
				>
					{results.map((user) => (
						<button
							key={user.id}
							type="button"
							onClick={() => handleSelect(user)}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
						>
							<User className="h-4 w-4 text-muted-foreground" />
							<span>{user.username}</span>
						</button>
					))}
				</div>
			)}
		</div>
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

	// Form state
	const [recipientQuery, setRecipientQuery] = useState("");
	const [selectedRecipient, setSelectedRecipient] = useState<UserSearchResult | null>(null);
	const [subject, setSubject] = useState("");
	const [content, setContent] = useState("");

	// UI state
	const [isSending, setIsSending] = useState(false);
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
		if (!selectedRecipient) {
			setError("请选择收信人");
			return;
		}

		if (!content.trim()) {
			setError("请输入站内信内容");
			return;
		}

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
			setIsSending(false);
		}
	}, [selectedRecipient, subject, content, onOpenChange, onSuccess, toast]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>写站内信</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-2">
					{/* Error message */}
					{error && (
						<div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
							<AlertCircle className="h-4 w-4 flex-shrink-0" />
							<span>{error}</span>
						</div>
					)}

					{/* Recipient */}
					<div className="grid gap-2">
						<Label htmlFor="recipient">收信人</Label>
						<UserAutocomplete
							value={recipientQuery}
							onChange={setRecipientQuery}
							selectedUser={selectedRecipient}
							onSelectUser={setSelectedRecipient}
							disabled={isSending}
						/>
					</div>

					{/* Subject */}
					<div className="grid gap-2">
						<Label htmlFor="subject">
							主题 <span className="text-muted-foreground">(可选)</span>
						</Label>
						<Input
							id="subject"
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
							rows={6}
							maxLength={10000}
							disabled={isSending}
							className="resize-none"
						/>
						<div className="text-xs text-muted-foreground text-right">{content.length}/10000</div>
					</div>
				</div>

				<DialogFooter>
					<DialogClose render={<Button variant="outline" disabled={isSending} />}>取消</DialogClose>
					<Button onClick={handleSubmit} disabled={isSending || !selectedRecipient}>
						{isSending ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin mr-1" />
								发送中...
							</>
						) : (
							<>
								<Send className="h-4 w-4 mr-1" />
								发送
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
