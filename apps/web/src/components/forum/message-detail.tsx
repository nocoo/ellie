// MessageDetailClient — Single message detail view with reply functionality

"use client";

import { ArrowLeft, Loader2, Mail, Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import { ForumPageHeader } from "@/components/forum/forum-page-header";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError, deleteMessage, fetchMessage, type Message } from "@/viewmodels/forum/messages";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { useForumToast } from "./forum-toast";
import { ForumAvatar } from "./user-avatar";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageDetailClientProps {
	messageId: number;
	breadcrumbs: BreadcrumbItem[];
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
// Main Component
// ---------------------------------------------------------------------------

export function MessageDetailClient({ messageId, breadcrumbs }: MessageDetailClientProps) {
	const router = useRouter();
	const { data: session } = useSession();
	const toast = useForumToast();

	// Get current user ID from session
	const currentUserId = session?.user?.id ? Number.parseInt(session.user.id, 10) : null;

	// State
	const [message, setMessage] = useState<Message | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const deleteInFlight = useRef(false);
	const loadGeneration = useRef(0);
	const replyGateRef = useRef(false);
	const [replyBusy, setReplyBusy] = useState(false);

	// Reply dialog state
	const [isReplyOpen, setIsReplyOpen] = useState(false);
	const [replyRecipient, setReplyRecipient] = useState<
		{ id: number; username: string } | undefined
	>(undefined);

	// Load message
	const loadMessage = useCallback(async () => {
		const generation = ++loadGeneration.current;
		setIsLoading(true);
		setError(null);

		try {
			const result = await fetchMessage(messageId);
			if (generation !== loadGeneration.current) return;
			setMessage(result);
		} catch (err) {
			if (generation !== loadGeneration.current) return;
			const message = err instanceof ApiError ? err.message : "加载失败，请重试";
			setError(message);
			toast.error({ title: "站内信加载失败", description: message });
		} finally {
			if (generation === loadGeneration.current) setIsLoading(false);
		}
	}, [messageId, toast]);

	// Initial load
	useEffect(() => {
		loadMessage();
	}, [loadMessage]);

	// Handle delete
	const handleDelete = async () => {
		if (deleteInFlight.current) return;
		deleteInFlight.current = true;
		setIsDeleting(true);
		try {
			await deleteMessage(messageId);
			setDeleteOpen(false);
			toast.success("站内信已删除");
			router.push("/messages");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败，请重试";
			toast.error({ title: "删除失败", description: message });
			deleteInFlight.current = false;
			setIsDeleting(false);
		}
	};

	// Handle reply - reply to the other party in the conversation
	const handleReply = async () => {
		if (!message || replyGateRef.current) return;
		replyGateRef.current = true;
		setReplyBusy(true);
		try {
			if (await writeGatePreflight(null, "message")) return;

			// If I'm the sender, reply to the receiver; otherwise reply to the sender
			const isSender = currentUserId === message.senderId;
			if (isSender) {
				setReplyRecipient({ id: message.receiverId, username: message.receiverName });
			} else {
				setReplyRecipient({ id: message.senderId, username: message.senderName });
			}
			setIsReplyOpen(true);
		} finally {
			replyGateRef.current = false;
			setReplyBusy(false);
		}
	};

	// Loading state
	if (isLoading) {
		return (
			<div className="py-12 text-center" role="status" aria-busy="true">
				<Loader2
					className="mx-auto h-6 w-6 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
				<p className="mt-2 text-sm text-muted-foreground">加载中...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="py-12 text-center" role="alert">
				<p className="text-sm text-destructive">{error}</p>
				<div className="mt-4 flex justify-center gap-2">
					<Button variant="outline" size="sm" onClick={() => void loadMessage()}>
						重试
					</Button>
					<Button variant="outline" size="sm" onClick={() => router.push("/messages")}>
						返回列表
					</Button>
				</div>
			</div>
		);
	}

	// No message
	if (!message) {
		return (
			<div className="py-12 text-center text-sm text-muted-foreground">站内信不存在或已被删除</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Breadcrumbs */}
			<BreadcrumbBar items={breadcrumbs} />

			<ForumPageHeader
				icon={<Mail />}
				title={message.subject || "站内信"}
				description={formatMessageDate(message.createdAt)}
				actions={
					<>
						<Button
							variant="ghost"
							nativeButton={false}
							render={<Link prefetch={false} href="/messages" role="link" />}
						>
							<ArrowLeft className="size-4" aria-hidden="true" />
							返回列表
						</Button>
						<Button onClick={() => void handleReply()} disabled={replyBusy} aria-busy={replyBusy}>
							<Reply className="size-4" aria-hidden="true" />
							回复
						</Button>
						<Button
							variant="outline"
							size="icon"
							onClick={() => setDeleteOpen(true)}
							disabled={isDeleting}
							aria-busy={isDeleting}
							aria-label="删除站内信"
							className="text-destructive hover:text-destructive"
						>
							<Trash2 className="size-4" aria-hidden="true" />
						</Button>
					</>
				}
			/>
			<article className="overflow-hidden rounded-2xl border border-border bg-card">
				<div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
					{message.senderId > 0 ? (
						<Link prefetch={false} href={`/users/${message.senderId}`} className="shrink-0">
							<ForumAvatar userId={message.senderId} userName={message.senderName} size="md" />
						</Link>
					) : (
						<ForumAvatar userId={0} userName={message.senderName || "未知用户"} size="md" />
					)}
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
						{message.senderId > 0 ? (
							<Link
								prefetch={false}
								href={`/users/${message.senderId}`}
								className="break-all font-medium hover:text-primary"
							>
								{message.senderName}
							</Link>
						) : (
							<span>{message.senderName || "未知用户"}</span>
						)}
						<span className="text-xs text-muted-foreground">发给</span>
						{message.receiverId > 0 ? (
							<Link
								prefetch={false}
								href={`/users/${message.receiverId}`}
								className="break-all font-medium hover:text-primary"
							>
								{message.receiverName}
							</Link>
						) : (
							<span>{message.receiverName || "未知用户"}</span>
						)}
					</div>
				</div>
				<div className="min-h-40 whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-4 py-5 text-[15px] leading-7 text-foreground sm:px-5">
					{message.content}
				</div>
			</article>
			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={(open) => {
					if (deleteInFlight.current) return;
					setDeleteOpen(open);
				}}
				title="删除站内信"
				description="确定要删除这条站内信吗？删除后将从你的信箱中移除。"
				confirmText="确认删除"
				variant="destructive"
				loading={isDeleting}
				onConfirm={handleDelete}
			/>

			{/* Reply dialog */}
			<ComposeMessageDialog
				open={isReplyOpen}
				onOpenChange={setIsReplyOpen}
				initialRecipient={replyRecipient}
			/>
		</div>
	);
}
