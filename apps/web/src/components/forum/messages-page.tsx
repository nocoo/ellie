// components/forum/messages-page.tsx — 站内信 (private messaging) page layout
// Two-column layout: sidebar (left) + message list (right).

"use client";

import { CheckCheck, Inbox, Loader2, Mail, PenLine, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import { ForumPageHeader } from "@/components/forum/forum-page-header";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { MessageListItem, SidebarItem } from "@/viewmodels/forum/messages";
import {
	ApiError,
	deleteMessage,
	fetchMessages,
	fetchUnreadCount,
	markAllMessagesRead,
	SIDEBAR_ITEMS,
} from "@/viewmodels/forum/messages";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
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
		<ForumPageHeader
			icon={<Mail />}
			title="站内信"
			description="在这里查看来信，继续与社区成员的交流。"
			actions={
				<>
					{activeBox === "inbox" && unreadCount > 0 && (
						<Button variant="outline" onClick={onMarkAllRead} disabled={isMarkingAllRead}>
							<CheckCheck className="size-4" aria-hidden="true" />
							{isMarkingAllRead ? "处理中..." : "全部已读"}
						</Button>
					)}
					<Button onClick={onCompose}>
						<PenLine className="size-4" aria-hidden="true" />
						写站内信
					</Button>
				</>
			}
		/>
	);
}

function MessagesHeader({
	activeBox,
	onBoxChange,
	unreadCount,
}: {
	activeBox: "inbox" | "outbox";
	onBoxChange: (value: "inbox" | "outbox") => void;
	unreadCount: number;
}) {
	return (
		<nav aria-label="站内信分类" className="flex items-center gap-2 border-b border-border p-3">
			{SIDEBAR_ITEMS.map((item) => {
				const Icon = SIDEBAR_ICONS[item.icon];
				return (
					<Button
						key={item.value}
						variant={item.value === activeBox ? "secondary" : "ghost"}
						aria-pressed={item.value === activeBox}
						onClick={() => onBoxChange(item.value)}
					>
						<Icon className="size-4" aria-hidden="true" />
						{item.label}
						{item.value === "inbox" && unreadCount > 0 && (
							<span className="rounded-md bg-primary/10 px-1.5 text-xs font-semibold text-primary tabular-nums">
								{unreadCount}
							</span>
						)}
					</Button>
				);
			})}
		</nav>
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
				"group flex min-w-0 gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 transition-colors hover:bg-accent/50",
				!message.isRead && isInbox && "bg-primary/[0.03]",
			)}
		>
			{peerId > 0 ? (
				<Link href={`/users/${peerId}`} prefetch={false} className="shrink-0">
					<ForumAvatar userId={peerId} userName={peerName} size="md" />
				</Link>
			) : (
				<ForumAvatar userId={0} userName={peerName || "未知用户"} size="md" />
			)}
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					{!isInbox && <span>发送给</span>}
					{peerId > 0 ? (
						<Link
							href={`/users/${peerId}`}
							prefetch={false}
							className="max-w-40 truncate font-medium text-foreground hover:text-primary"
						>
							{peerName}
						</Link>
					) : (
						<span>{peerName || "未知用户"}</span>
					)}
					<time
						dateTime={new Date(message.createdAt * 1000).toISOString()}
						className="sm:ml-auto tabular-nums"
					>
						{formatMessageDate(message.createdAt)}
					</time>
				</div>
				<Link
					href={`/messages/${message.id}`}
					prefetch={false}
					className="mt-1.5 block space-y-1 rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
				>
					<span
						className={cn(
							"block break-words line-clamp-2 text-sm text-foreground",
							!message.isRead && isInbox ? "font-semibold" : "font-medium",
						)}
					>
						{message.subject || "无主题"}
					</span>
					<span className="block break-words line-clamp-2 text-sm leading-relaxed text-muted-foreground">
						{message.preview}
					</span>
				</Link>
				<div className="mt-2 flex items-center gap-3 text-xs">
					<span
						className={cn(
							"inline-flex items-center gap-1.5",
							!message.isRead && isInbox ? "text-primary" : "text-muted-foreground",
						)}
					>
						{message.isRead ? (
							<CheckCheck className="size-3.5" aria-hidden="true" />
						) : (
							<Mail className="size-3.5" aria-hidden="true" />
						)}
						{message.isRead ? "已读" : "未读"}
					</span>
					<Link
						href={`/messages/${message.id}`}
						prefetch={false}
						className="text-primary hover:underline"
					>
						查看
					</Link>
				</div>
			</div>
			<Button
				variant="ghost"
				size="icon"
				className="shrink-0 self-center text-muted-foreground hover:text-destructive"
				onClick={() => onDelete(message.id)}
				title="删除"
				aria-label="删除站内信"
			>
				<Trash2 className="size-4" aria-hidden="true" />
			</Button>
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
		return (
			<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" aria-hidden="true" />
				加载中...
			</div>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
				<Inbox className="size-8 text-primary/60" aria-hidden="true" />
				{box === "inbox" ? "收信箱为空" : "发信箱为空"}
			</div>
		);
	}

	return (
		<div>
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
	const activeBoxRef = useRef(initialBox);
	const [messages, setMessages] = useState<MessageListItem[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [unreadCount, setUnreadCount] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
	const markingAllReadRef = useRef(false);
	const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const deleteInFlight = useRef(false);
	const loadGeneration = useRef(0);

	// Compose dialog state
	const [isComposeOpen, setIsComposeOpen] = useState(false);
	const [composeRecipient, setComposeRecipient] = useState<
		{ id: number; username: string } | undefined
	>(undefined);

	// Fetch messages
	const loadMessages = useCallback(async (box: "inbox" | "outbox", nextCursor?: string) => {
		const generation = ++loadGeneration.current;
		setIsLoading(true);
		setError(null);

		try {
			const result = await fetchMessages(box, nextCursor);
			if (generation !== loadGeneration.current) return;

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
			if (generation !== loadGeneration.current) return;
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError("加载失败，请重试");
			}
		} finally {
			if (generation === loadGeneration.current) setIsLoading(false);
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
		return () => {
			loadGeneration.current++;
		};
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
		activeBoxRef.current = box;
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
	const handleDelete = async () => {
		if (pendingDeleteId === null || deleteInFlight.current) return;
		const id = pendingDeleteId;
		deleteInFlight.current = true;
		setIsDeleting(true);
		try {
			await deleteMessage(id);
			setPendingDeleteId(null);
			setMessages((prev) => prev.filter((m) => m.id !== id));
			// Refresh unread count
			loadUnreadCount();
			toast.success("站内信已删除");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败，请重试";
			toast.error({ title: "删除失败", description: message });
		} finally {
			deleteInFlight.current = false;
			setIsDeleting(false);
		}
	};

	// Handle load more
	const handleLoadMore = () => {
		if (cursor && !isLoading) {
			loadMessages(activeBox, cursor);
		}
	};

	// Handle mark all read
	const handleMarkAllRead = async () => {
		if (markingAllReadRef.current) return;
		markingAllReadRef.current = true;
		setIsMarkingAllRead(true);
		try {
			await markAllMessagesRead();
			setMessages((prev) =>
				activeBoxRef.current === "inbox" ? prev.map((m) => ({ ...m, isRead: true })) : prev,
			);
			setUnreadCount(0);
			toast.success("已全部标记为已读");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "操作失败，请重试";
			toast.error({ title: "标记已读失败", description: message });
		} finally {
			markingAllReadRef.current = false;
			setIsMarkingAllRead(false);
		}
	};

	return (
		<div className="space-y-4">
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

			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<MessagesHeader
					activeBox={activeBox}
					onBoxChange={handleBoxChange}
					unreadCount={unreadCount}
				/>
				{error && (
					<div
						role="alert"
						className="m-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
					>
						<span className="flex-1">{error}</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() => loadMessages(activeBox)}
							disabled={isLoading}
						>
							重试
						</Button>
					</div>
				)}
				{!error || messages.length > 0 ? (
					<MessageList
						messages={messages}
						box={activeBox}
						isLoading={isLoading}
						onDelete={setPendingDeleteId}
						onLoadMore={handleLoadMore}
						hasMore={cursor !== null}
					/>
				) : null}
				{!isLoading && !error && messages.length > 0 && (
					<div className="border-t border-border px-4 py-3 text-xs text-muted-foreground tabular-nums">
						已加载 {messages.length} 封站内信
					</div>
				)}
			</div>
			<ConfirmDialog
				open={pendingDeleteId !== null}
				onOpenChange={(open) => {
					if (!open && !isDeleting) setPendingDeleteId(null);
				}}
				title="删除站内信"
				description="确定要删除这条站内信吗？删除后将从你的信箱中移除。"
				confirmText="确认删除"
				variant="destructive"
				loading={isDeleting}
				onConfirm={handleDelete}
			/>

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
