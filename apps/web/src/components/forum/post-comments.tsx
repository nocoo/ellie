// components/forum/post-comments.tsx — Post comments (点评) display and input
// Shows comments under a post with ability to add new ones

"use client";

import type { PostComment } from "@ellie/types";
import { Loader2, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { handleSubmitShortcut } from "@/lib/composer-keyboard";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { useForumToast } from "./forum-toast";
import { ForumAvatar } from "./user-avatar";

interface PostCommentsProps {
	postId: number;
	threadClosed?: boolean;
	isLoggedIn: boolean;
	/** Optional preloaded comments. Otherwise read only after clicking 查看点评. */
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
	const fieldId = useId();
	const errorId = useId();
	const [content, setContent] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const toast = useForumToast();

	useEffect(() => {
		if (open && !submittingRef.current) setError(null);
	}, [open]);

	const handleSubmit = useCallback(async () => {
		if (submittingRef.current) return;
		if (!content.trim()) {
			setError("请输入点评内容");
			return;
		}

		submittingRef.current = true;
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
			submittingRef.current = false;
			setSubmitting(false);
		}
	}, [content, postId, onOpenChange, onSuccess, toast]);

	return (
		<Dialog open={open} onOpenChange={(next) => !submittingRef.current && onOpenChange(next)}>
			<DialogContent className="max-w-md" showCloseButton={!submitting} aria-busy={submitting}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MessageCircle className="h-5 w-5" aria-hidden="true" />
						发表点评
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor={fieldId}>点评内容</Label>
						<Textarea
							id={fieldId}
							placeholder="写下你的点评（最多255字）"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							maxLength={255}
							rows={3}
							disabled={submitting}
							aria-invalid={error !== null || undefined}
							aria-describedby={error ? errorId : undefined}
							aria-keyshortcuts="Control+Enter Meta+Enter"
							onKeyDown={(event) => {
								handleSubmitShortcut(event.nativeEvent, () => {
									void handleSubmit();
								});
							}}
						/>
						<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
							<span>Enter 换行，Ctrl/⌘+Enter 发送</span>
							<span>{content.length}/255</span>
						</div>
					</div>
					{error && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							onClick={() => {
								if (submittingRef.current) return;
								onOpenChange(false);
							}}
							disabled={submitting}
						>
							取消
						</Button>
						<Button
							onClick={() => void handleSubmit()}
							disabled={submitting}
							aria-busy={submitting}
						>
							{submitting ? (
								<Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />
							) : (
								<Send className="h-4 w-4 mr-1" aria-hidden="true" />
							)}
							{submitting ? "发送中" : "发送"}
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
	const [loaded, setLoaded] = useState(initialComments !== undefined);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState(false);
	const [internalDialogOpen, setInternalDialogOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const loadingRef = useRef(false);
	const commentGateRef = useRef(false);
	const [commentGateBusy, setCommentGateBusy] = useState(false);
	const toast = useForumToast();

	// Use external dialog state if provided, otherwise use internal
	const dialogOpen = externalDialogOpen ?? internalDialogOpen;
	const setDialogOpen = onDialogOpenChange ?? setInternalDialogOpen;

	const fetchComments = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
		setLoadError(false);
		try {
			// Use searchParams object form so the helper handles encoding and
			// undefined/null filtering. Never string-concat user-supplied
			// values into the URL.
			const response = await apiClient.get<PostComment[]>("/api/v1/post-comments", {
				postId,
				limit: "all",
			});
			setComments((previous) => [
				...new Map([...response.data, ...previous].map((row) => [row.id, row])).values(),
			]);
			setLoaded(true);
		} catch {
			setLoadError(true);
			toast.error({ title: "点评加载失败", description: "请稍后重试" });
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}, [postId, toast]);

	const handleCommentSuccess = useCallback((newComment: PostComment) => {
		// Show the confirmed write immediately, without waiting for shared cache expiry.
		setComments((prev) => [...prev, newComment]);
		// Also expand to show the new comment if list was collapsed
		setExpanded(true);
	}, []);

	const loadButton = !loaded && (
		<button
			type="button"
			disabled={loading}
			onClick={() => void fetchComments()}
			aria-busy={loading}
			aria-live="polite"
			className="text-xs text-forum-link hover:underline py-1.5"
		>
			{loading ? "加载点评…" : loadError ? "加载失败，重试点评" : "查看点评"}
		</button>
	);

	if (comments.length === 0) {
		return (
			<>
				{loadButton}
				<CommentDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					postId={postId}
					onSuccess={handleCommentSuccess}
				/>
			</>
		);
	}

	// Determine which comments to show
	const MAX_COLLAPSED = 3;
	const visibleComments = expanded ? comments : comments.slice(0, MAX_COLLAPSED);
	const hasMore = comments.length > MAX_COLLAPSED;

	return (
		<div className="border-t border-dashed border-border">
			{loadButton}
			{/* Header - theme-aware colors */}
			<div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
				<span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
					<MessageCircle className="h-3.5 w-3.5" />
					点评
				</span>
				{!threadClosed && isLoggedIn && (
					<button
						type="button"
						disabled={commentGateBusy}
						aria-busy={commentGateBusy}
						onClick={async () => {
							if (commentGateRef.current) return;
							commentGateRef.current = true;
							setCommentGateBusy(true);
							try {
								if (await writeGatePreflight(null, "comment")) return;
								setDialogOpen(true);
							} finally {
								commentGateRef.current = false;
								setCommentGateBusy(false);
							}
						}}
						className="text-xs text-forum-link hover:underline cursor-pointer disabled:opacity-50"
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
						<span
							className="text-xs text-muted-foreground flex-shrink-0 ml-auto"
							data-testid="post-comment-time"
						>
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
