// components/forum/messages-page.tsx — 站内信 (private messaging) page layout
// Two-column layout: sidebar (left) + message list (right).

"use client";

import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MessageListItem, SidebarItem } from "@/viewmodels/forum/messages";
import {
	ApiError,
	SIDEBAR_ITEMS,
	deleteMessage,
	fetchMessages,
	fetchUnreadCount,
	markAllMessagesRead,
} from "@/viewmodels/forum/messages";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { CheckCheck, Mail, PenLine, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForumToast } from "./forum-toast";
import { ForumAvatar } from "./user-avatar";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessagesPageClientProps {
	breadcrumbs: BreadcrumbItem[];
	initialBox?: "inbox" | "outbox";
	/** Pre-filled recipient for compose dialog (from ?to=N URL parameter) */
	initialRecipient?: { id: number; username: string };
}

// ---------------------------------------------------------------------------
// Icon resolver for sidebar items
// ---------------------------------------------------------------------------

const SIDEBAR_ICONS: Record<SidebarItem["icon"], React.ElementType> = {
	mail: Mail,
	send: Send,
};

// ---------------------------------------------------------------------------
// Left sidebar
// ---------------------------------------------------------------------------

function MessagesSidebar({
	items,
	activeBox,
	onBoxChange,
	unreadCount,
}: {
	items: SidebarItem[];
	activeBox: "inbox" | "outbox";
	onBoxChange: (v: "inbox" | "outbox") => void;
	unreadCount: number;
}) {
	return (
		<aside className="w-[160px] flex-shrink-0">
			<h2 className="text-base font-bold text-foreground mb-3">站内信</h2>
			<nav className="flex flex-col gap-0.5">
				{items.map((item) => {
					const Icon = SIDEBAR_ICONS[item.icon];
					const isActive = item.value === activeBox;
					const badge = item.value === "inbox" && unreadCount > 0 ? unreadCount : undefined;

					return (
						<button
							key={item.value}
							type="button"
							onClick={() => onBoxChange(item.value)}
							className={cn(
								"flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors text-left",
								isActive ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="h-4 w-4 flex-shrink-0" />
							<span>{item.label}</span>
							{badge !== undefined && (
								<span
									className={cn(
										"text-xs",
										isActive ? "text-primary font-bold" : "text-muted-foreground",
									)}
								>
									({badge})
								</span>
							)}
						</button>
					);
				})}
			</nav>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Header section with title, compose button, and mark all read
// ---------------------------------------------------------------------------

function MessagesHeaderSection({
	activeBox,
	unreadCount,
	onCompose,
	onMarkAllRead,
	isMarkingAllRead,
}: {
	activeBox: "inbox" | "outbox";
	unreadCount: number;
	onCompose: () => void;
	onMarkAllRead: () => void;
	isMarkingAllRead: boolean;
}) {
	return (
		<div className="rounded-sm border border-border bg-gradient-to-br from-primary/5 via-background to-primary/[0.02] p-4">
			<div className="flex items-start gap-4">
				{/* Icon and title */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<Mail className="h-6 w-6 text-primary shrink-0" />
						<h1 className="text-lg font-semibold text-foreground">站内信</h1>
					</div>
					<p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">私信沟通，畅所欲言</p>
				</div>
				{/* Actions */}
				<div className="flex items-center gap-2 shrink-0">
					{activeBox === "inbox" && unreadCount > 0 && (
						<Button
							variant="outline"
							size="sm"
							onClick={onMarkAllRead}
							disabled={isMarkingAllRead}
							className="gap-2"
						>
							<CheckCheck className="h-4 w-4" />
							{isMarkingAllRead ? "处理中..." : "全部已读"}
						</Button>
					)}
					<Button onClick={onCompose} className="shrink-0 gap-2 bg-primary hover:bg-primary/90">
						<PenLine className="h-4 w-4" />
						写站内信
					</Button>
				</div>
			</div>
			{activeBox === "inbox" && unreadCount > 0 && (
				<div className="mt-3 pt-3 border-t border-border/50 text-sm text-muted-foreground">
					您有 <span className="font-bold text-primary">{unreadCount}</span> 条未读站内信
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Header with box tabs (moved compose button to header section)
// ---------------------------------------------------------------------------

function MessagesHeader({
	activeBox,
	onBoxChange,
}: {
	activeBox: "inbox" | "outbox";
	onBoxChange: (v: "inbox" | "outbox") => void;
}) {
	const tabs = [
		{ value: "inbox" as const, label: "收信箱" },
		{ value: "outbox" as const, label: "发信箱" },
	];

	return (
		<div className="flex items-center border-b border-border pb-0">
			<div className="flex items-end">
				{tabs.map((tab) => {
					const isActive = tab.value === activeBox;
					return (
						<button
							key={tab.value}
							type="button"
							onClick={() => onBoxChange(tab.value)}
							className={cn(
								"px-4 py-2 text-sm font-medium transition-colors border border-border -mb-px",
								isActive
									? "bg-card text-foreground border-b-card"
									: "bg-muted text-muted-foreground hover:text-foreground border-b-border",
							)}
						>
							{tab.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Format date
// ---------------------------------------------------------------------------

function formatMessageDate(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	return date.toLocaleString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// ---------------------------------------------------------------------------
// Single message row
// ---------------------------------------------------------------------------

function MessageRow({
	message,
	box,
	onDelete,
}: {
	message: MessageListItem;
	box: "inbox" | "outbox";
	onDelete: (id: number) => void;
}) {
	const isInbox = box === "inbox";
	const peerId = isInbox ? message.senderId : message.receiverId;
	const peerName = isInbox ? message.senderName : message.receiverName;

	return (
		<div
			className={cn(
				"flex gap-3 border-b border-border py-4 last:border-b-0",
				!message.isRead && isInbox && "bg-muted/30",
			)}
		>
			{/* Avatar */}
			<div className="flex-shrink-0">
				<Link href={`/users/${peerId}`} prefetch={false}>
					<ForumAvatar userId={peerId} userName={peerName} size="lg" shadow />
				</Link>
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				{/* Header */}
				<div className="text-sm">
					{isInbox ? (
						<>
							<Link
								href={`/users/${peerId}`}
								prefetch={false}
								className="font-bold text-foreground hover:text-primary"
							>
								{peerName}
							</Link>
							<span className="text-muted-foreground"> 发来：</span>
						</>
					) : (
						<>
							<span className="text-muted-foreground">发送给 </span>
							<Link
								href={`/users/${peerId}`}
								prefetch={false}
								className="font-bold text-foreground hover:text-primary"
							>
								{peerName}
							</Link>
							<span className="text-muted-foreground">：</span>
						</>
					)}
					{message.subject && (
						<span className="font-medium text-foreground ml-1">{message.subject}</span>
					)}
					{!message.isRead && isInbox && (
						<span className="ml-2 inline-block h-2 w-2 rounded-full bg-destructive" title="未读" />
					)}
				</div>

				{/* Preview */}
				<Link
					href={`/messages/${message.id}`}
					prefetch={false}
					className="block mt-1 text-sm text-muted-foreground leading-relaxed line-clamp-2 hover:text-foreground"
				>
					{message.preview}
				</Link>

				{/* Footer */}
				<div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
					<span>{formatMessageDate(message.createdAt)}</span>
					<div className="flex items-center gap-2">
						<Link
							href={`/messages/${message.id}`}
							prefetch={false}
							className="text-primary hover:underline"
						>
							查看
						</Link>
						<button
							type="button"
							onClick={() => onDelete(message.id)}
							className="text-muted-foreground hover:text-destructive"
							title="删除"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------

function MessageList({
	messages,
	box,
	isLoading,
	onDelete,
	onLoadMore,
	hasMore,
}: {
	messages: MessageListItem[];
	box: "inbox" | "outbox";
	isLoading: boolean;
	onDelete: (id: number) => void;
	onLoadMore: () => void;
	hasMore: boolean;
}) {
	if (isLoading && messages.length === 0) {
		return <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>;
	}

	if (messages.length === 0) {
		return (
			<div className="py-12 text-center text-sm text-muted-foreground">
				{box === "inbox" ? "收信箱为空" : "发信箱为空"}
			</div>
		);
	}

	return (
		<div className="mt-2">
			{messages.map((msg) => (
				<MessageRow key={msg.id} message={msg} box={box} onDelete={onDelete} />
			))}
			{hasMore && (
				<div className="py-4 text-center">
					<Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoading}>
						{isLoading ? "加载中..." : "加载更多"}
					</Button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export: MessagesPageClient
// ---------------------------------------------------------------------------

export function MessagesPageClient({
	breadcrumbs,
	initialBox = "inbox",
	initialRecipient,
}: MessagesPageClientProps) {
	const router = useRouter();
	const toast = useForumToast();

	// State
	const [activeBox, setActiveBox] = useState<"inbox" | "outbox">(initialBox);
	const [messages, setMessages] = useState<MessageListItem[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [unreadCount, setUnreadCount] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

	// Compose dialog state
	const [isComposeOpen, setIsComposeOpen] = useState(false);
	const [composeRecipient, setComposeRecipient] = useState<
		{ id: number; username: string } | undefined
	>(undefined);

	// Fetch messages
	const loadMessages = useCallback(async (box: "inbox" | "outbox", nextCursor?: string) => {
		setIsLoading(true);
		setError(null);

		try {
			const result = await fetchMessages(box, nextCursor);

			if (nextCursor) {
				setMessages((prev) => [...prev, ...result.messages]);
			} else {
				setMessages(result.messages);
			}
			setCursor(result.nextCursor);

			if (result.unreadCount !== undefined) {
				setUnreadCount(result.unreadCount);
			}
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError("加载失败，请重试");
			}
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Fetch unread count separately (for outbox view)
	const loadUnreadCount = useCallback(async () => {
		const count = await fetchUnreadCount();
		setUnreadCount(count);
	}, []);

	// Initial load
	useEffect(() => {
		loadMessages(activeBox);
	}, [activeBox, loadMessages]);

	// Load unread count when viewing outbox
	useEffect(() => {
		if (activeBox === "outbox") {
			loadUnreadCount();
		}
	}, [activeBox, loadUnreadCount]);

	// Handle box change
	const handleBoxChange = (box: "inbox" | "outbox") => {
		if (box === activeBox) return;
		setActiveBox(box);
		setMessages([]);
		setCursor(null);
		// Update URL without navigation
		router.replace(box === "inbox" ? "/messages" : "/messages?box=outbox", { scroll: false });
	};

	// Handle compose
	const handleCompose = useCallback(async () => {
		if (await writeGatePreflight(null, "message")) return;
		// Reset recipient before opening
		setComposeRecipient(undefined);
		setIsComposeOpen(true);
	}, []);

	// Handle message sent success
	const handleMessageSent = useCallback(() => {
		// Refresh message list if in outbox
		if (activeBox === "outbox") {
			loadMessages("outbox");
		}
	}, [activeBox, loadMessages]);

	// Auto-open compose dialog with pre-filled recipient from ?to=N parameter
	useEffect(() => {
		if (!initialRecipient) return;
		let cancelled = false;
		writeGatePreflight(null, "message").then((blocked) => {
			if (cancelled) return;
			if (blocked) {
				router.replace("/messages", { scroll: false });
				return;
			}
			setComposeRecipient(initialRecipient);
			setIsComposeOpen(true);
			router.replace("/messages", { scroll: false });
		});
		return () => {
			cancelled = true;
		};
	}, [initialRecipient, router]);

	// Handle delete
	const handleDelete = async (id: number) => {
		if (!confirm("确定要删除这条站内信吗？")) return;

		try {
			await deleteMessage(id);
			setMessages((prev) => prev.filter((m) => m.id !== id));
			// Refresh unread count
			loadUnreadCount();
			toast.success("站内信已删除");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败，请重试";
			toast.error({ title: "删除失败", description: message });
		}
	};

	// Handle load more
	const handleLoadMore = () => {
		if (cursor) {
			loadMessages(activeBox, cursor);
		}
	};

	// Handle mark all read
	const handleMarkAllRead = async () => {
		setIsMarkingAllRead(true);
		try {
			await markAllMessagesRead();
			// Update local state to mark all messages as read
			setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
			setUnreadCount(0);
			toast.success("已全部标记为已读");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "操作失败，请重试";
			toast.error({ title: "标记已读失败", description: message });
		} finally {
			setIsMarkingAllRead(false);
		}
	};

	return (
		<div className="space-y-2">
			{/* Breadcrumbs */}
			<BreadcrumbBar items={breadcrumbs} />

			{/* Header section with title and compose button */}
			<MessagesHeaderSection
				activeBox={activeBox}
				unreadCount={unreadCount}
				onCompose={handleCompose}
				onMarkAllRead={handleMarkAllRead}
				isMarkingAllRead={isMarkingAllRead}
			/>

			{/* Two-column layout */}
			<div className="flex gap-4">
				{/* Left sidebar */}
				<MessagesSidebar
					items={SIDEBAR_ITEMS}
					activeBox={activeBox}
					onBoxChange={handleBoxChange}
					unreadCount={unreadCount}
				/>

				{/* Right content area */}
				<div className="flex-1 min-w-0">
					{/* Header with tabs */}
					<MessagesHeader activeBox={activeBox} onBoxChange={handleBoxChange} />

					{/* Error message */}
					{error && (
						<div className="mt-4 rounded border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
							{error}
						</div>
					)}

					{/* Message list */}
					<MessageList
						messages={messages}
						box={activeBox}
						isLoading={isLoading}
						onDelete={handleDelete}
						onLoadMore={handleLoadMore}
						hasMore={cursor !== null}
					/>
				</div>
			</div>

			{/* Compose message dialog */}
			<ComposeMessageDialog
				open={isComposeOpen}
				onOpenChange={setIsComposeOpen}
				initialRecipient={composeRecipient}
				onSuccess={handleMessageSent}
			/>
		</div>
	);
}

// Keep the old export name for backward compatibility during migration
export const MessagesPage = MessagesPageClient;
