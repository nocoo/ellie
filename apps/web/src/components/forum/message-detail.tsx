// MessageDetailClient — Single message detail view with reply functionality

"use client";

import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError, type Message, deleteMessage, fetchMessage } from "@/viewmodels/forum/messages";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { ArrowLeft, Loader2, Reply, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

	// Reply dialog state
	const [isReplyOpen, setIsReplyOpen] = useState(false);
	const [replyRecipient, setReplyRecipient] = useState<
		{ id: number; username: string } | undefined
	>(undefined);

	// Load message
	const loadMessage = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const result = await fetchMessage(messageId);
			setMessage(result);
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError("加载失败，请重试");
			}
		} finally {
			setIsLoading(false);
		}
	}, [messageId]);

	// Initial load
	useEffect(() => {
		loadMessage();
	}, [loadMessage]);

	// Handle delete
	const handleDelete = async () => {
		if (!confirm("确定要删除这条站内信吗？")) return;

		setIsDeleting(true);
		try {
			await deleteMessage(messageId);
			toast.success("站内信已删除");
			router.push("/messages");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败，请重试";
			toast.error({ title: "删除失败", description: message });
			setIsDeleting(false);
		}
	};

	// Handle reply - reply to the other party in the conversation
	const handleReply = async () => {
		if (!message) return;
		if (await writeGatePreflight(null, "message")) return;

		// If I'm the sender, reply to the receiver; otherwise reply to the sender
		const isSender = currentUserId === message.senderId;
		if (isSender) {
			setReplyRecipient({ id: message.receiverId, username: message.receiverName });
		} else {
			setReplyRecipient({ id: message.senderId, username: message.senderName });
		}
		setIsReplyOpen(true);
	};

	// Loading state
	if (isLoading) {
		return (
			<div className="py-12 text-center">
				<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
				<p className="mt-2 text-sm text-muted-foreground">加载中...</p>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className="py-12 text-center">
				<p className="text-sm text-destructive">{error}</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-4"
					onClick={() => router.push("/messages")}
				>
					返回列表
				</Button>
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

			{/* Back link */}
			<div className="flex items-center gap-2">
				<Link
					href="/messages"
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					返回列表
				</Link>
			</div>

			{/* Message card */}
			<div className="rounded-lg border border-border bg-card p-4">
				{/* Header */}
				<div className="flex items-start justify-between border-b border-border pb-4">
					<div className="flex items-start gap-3">
						<Link href={`/users/${message.senderId}`}>
							<ForumAvatar
								userId={message.senderId}
								userName={message.senderName}
								size="lg"
								shadow
							/>
						</Link>
						<div>
							<div className="flex items-center gap-2">
								<Link
									href={`/users/${message.senderId}`}
									className="font-medium text-foreground hover:text-primary"
								>
									{message.senderName}
								</Link>
								<span className="text-muted-foreground">发给</span>
								<Link
									href={`/users/${message.receiverId}`}
									className="font-medium text-foreground hover:text-primary"
								>
									{message.receiverName}
								</Link>
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{formatMessageDate(message.createdAt)}
							</div>
						</div>
					</div>

					{/* Actions */}
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={handleReply}>
							<Reply className="h-4 w-4 mr-1" />
							回复
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleDelete}
							disabled={isDeleting}
							className="text-destructive hover:text-destructive"
						>
							{isDeleting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Trash2 className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>

				{/* Subject */}
				{message.subject && (
					<div className="pt-4 pb-2">
						<h2 className="font-medium text-foreground">{message.subject}</h2>
					</div>
				)}

				{/* Content */}
				<div
					className={cn(
						"py-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap",
						!message.subject && "pt-4",
					)}
				>
					{message.content}
				</div>
			</div>

			{/* Reply dialog */}
			<ComposeMessageDialog
				open={isReplyOpen}
				onOpenChange={setIsReplyOpen}
				initialRecipient={replyRecipient}
			/>
		</div>
	);
}
