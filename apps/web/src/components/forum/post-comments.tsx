// components/forum/post-comments.tsx — Post comments (点评) display and input
// Shows comments under a post with ability to add new ones

"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { PostComment } from "@ellie/types";
import { Loader2, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useForumToast } from "./forum-toast";
import { ForumAvatar } from "./user-avatar";

interface PostCommentsProps {
	postId: number;
	threadClosed?: boolean;
	isLoggedIn: boolean;
	/** SSR-provided initial comments — skips client-side fetch when present */
	initialComments?: PostComment[];
	/** External dialog state control */
	dialogOpen?: boolean;
	onDialogOpenChange?: (open: boolean) => void;
}

interface CommentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	postId: number;
	onSuccess: (newComment: PostComment) => void;
}

function formatCommentTime(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function CommentDialog({ open, onOpenChange, postId, onSuccess }: CommentDialogProps) {
	const [content, setContent] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const toast = useForumToast();

	const handleSubmit = useCallback(async () => {
		if (!content.trim()) return;

		setSubmitting(true);
		setError(null);

		try {
			const response = await apiClient.post<PostComment>("/api/v1/post-comments", {
				postId,
				content: content.trim(),
			});
			setContent("");
			onOpenChange(false);
			onSuccess(response.data);
			toast.success("点评已发送");
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "发送失败，请稍后重试";
			setError(message);
			toast.error({ title: "点评发送失败", description: message });
		} finally {
			setSubmitting(false);
		}
	}, [content, postId, onOpenChange, onSuccess, toast]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MessageCircle className="h-5 w-5" />
						发表点评
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="relative">
						<Input
							placeholder="写下你的点评（最多255字）"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							maxLength={255}
							disabled={submitting}
							className="pr-16"
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSubmit();
								}
							}}
						/>
						<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
							{content.length}/255
						</span>
					</div>
					{error && <p className="text-sm text-destructive">{error}</p>}
					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
							取消
						</Button>
						<Button onClick={handleSubmit} disabled={!content.trim() || submitting}>
							{submitting ? (
								<Loader2 className="h-4 w-4 animate-spin mr-1" />
							) : (
								<Send className="h-4 w-4 mr-1" />
							)}
							发送
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function PostComments({
	postId,
	threadClosed,
	isLoggedIn,
	initialComments,
	dialogOpen: externalDialogOpen,
	onDialogOpenChange,
}: PostCommentsProps) {
	const [comments, setComments] = useState<PostComment[]>(initialComments ?? []);
	const [loading, setLoading] = useState(!initialComments);
	const [internalDialogOpen, setInternalDialogOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);

	// Use external dialog state if provided, otherwise use internal
	const dialogOpen = externalDialogOpen ?? internalDialogOpen;
	const setDialogOpen = onDialogOpenChange ?? setInternalDialogOpen;

	const fetchComments = useCallback(async () => {
		try {
			// Use searchParams object form so the helper handles encoding and
			// undefined/null filtering. Never string-concat user-supplied
			// values into the URL.
			const response = await apiClient.get<PostComment[]>("/api/v1/post-comments", { postId });
			setComments(response.data);
		} catch (err) {
			console.error("[PostComments] fetch error:", err);
		} finally {
			setLoading(false);
		}
	}, [postId]);

	useEffect(() => {
		// Skip fetch when SSR-provided initialComments are available
		if (initialComments) return;
		fetchComments();
	}, [fetchComments, initialComments]);

	const handleCommentSuccess = useCallback((newComment: PostComment) => {
		// Add new comment to list immediately (optimistic update)
		setComments((prev) => [...prev, newComment]);
		// Also expand to show the new comment if list was collapsed
		setExpanded(true);
	}, []);

	// Don't render anything if no comments
	// The "点评" button is in PostActionBar, not here
	if (!loading && comments.length === 0) {
		return (
			<CommentDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				postId={postId}
				onSuccess={handleCommentSuccess}
			/>
		);
	}

	// Show loading or empty state with add button
	if (loading) {
		return null; // Don't show loading state, just skip
	}

	// Determine which comments to show
	const MAX_COLLAPSED = 3;
	const visibleComments = expanded ? comments : comments.slice(0, MAX_COLLAPSED);
	const hasMore = comments.length > MAX_COLLAPSED;

	return (
		<div className="border-t border-dashed border-border">
			{/* Header - theme-aware colors */}
			<div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
				<span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
					<MessageCircle className="h-3.5 w-3.5" />
					点评
				</span>
				{!threadClosed && isLoggedIn && (
					<button
						type="button"
						onClick={() => setDialogOpen(true)}
						className="text-xs text-forum-link hover:underline cursor-pointer"
					>
						+ 添加点评
					</button>
				)}
			</div>

			{/* Comment list */}
			<div className="divide-y divide-border/50">
				{visibleComments.map((comment) => (
					<div key={comment.id} className="px-3 py-1.5 flex items-center gap-2 text-xs">
						<Link href={`/users/${comment.authorId}`} prefetch={false} className="flex-shrink-0">
							<ForumAvatar userId={comment.authorId} userName={comment.authorName} size="xs" />
						</Link>
						<Link
							href={`/users/${comment.authorId}`}
							prefetch={false}
							className="font-medium text-forum-link hover:underline flex-shrink-0"
						>
							{comment.authorName}
						</Link>
						<span className="text-forum-text break-all">{comment.content}</span>
						<span className="text-2xs text-muted-foreground flex-shrink-0 ml-auto">
							{formatCommentTime(comment.createdAt)}
						</span>
					</div>
				))}
			</div>

			{/* Expand/collapse */}
			{hasMore && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="w-full text-center text-xs text-forum-link hover:underline py-1.5 bg-muted/30 cursor-pointer"
				>
					{expanded ? "收起" : `查看全部 ${comments.length} 条点评`}
				</button>
			)}

			<CommentDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				postId={postId}
				onSuccess={handleCommentSuccess}
			/>
		</div>
	);
}
