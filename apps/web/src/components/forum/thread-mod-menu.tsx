"use client";

// components/forum/thread-mod-menu.tsx — Thread moderation action bar
// Rendered inside ThreadToolbar before the first post and after the last post.

import {
	ArrowRight,
	BookmarkPlus,
	Highlighter,
	Lock,
	LockOpen,
	Pin,
	Star,
	Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForumToast } from "@/components/forum/forum-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError } from "@/lib/api-client";
import {
	deleteThread,
	type HighlightOptions,
	moveThread,
	recommendThread,
	type StickyLevel,
	setThreadClosed,
	setThreadDigest,
	setThreadHighlight,
	setThreadSticky,
	unrecommendThread,
} from "@/lib/moderation-api";
import { DigestDialog } from "./digest-dialog";
import { ForumActionButton } from "./forum-action-button";
import { HighlightDialog } from "./highlight-dialog";
import { MoveDialog } from "./move-dialog";
import { StickyDialog } from "./sticky-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadModMenuProps {
	threadId: number;
	forumId: number;
	/** Current sticky level (0=none, 1=forum, 2=global) */
	sticky: number;
	/** Current digest level (0-3) */
	digest: number;
	/** Current highlight value */
	highlight: number;
	/** Is thread currently closed? */
	closed: boolean;
	/**
	 * Is the thread currently in its forum's recommended-threads allowlist?
	 * Drives the "推荐 / 已推荐" toggle label. Source: thread payload from
	 * `GET /api/v1/threads/:id` (migration 0045 EXISTS probe).
	 */
	isRecommended: boolean;
	/** Can user manage thread (sticky/highlight/digest/close/recommend)? */
	canManageThread: boolean;
	/** Can user move thread? (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can user delete thread? (SuperMod/Admin or author) */
	canDeleteThread: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadModMenu({
	threadId,
	forumId,
	sticky,
	digest,
	highlight,
	closed,
	isRecommended,
	canManageThread,
	canMoveThread,
	canDeleteThread,
}: ThreadModMenuProps) {
	const router = useRouter();
	const toast = useForumToast();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Dialog states
	const [stickyDialogOpen, setStickyDialogOpen] = useState(false);
	const [highlightDialogOpen, setHighlightDialogOpen] = useState(false);
	const [digestDialogOpen, setDigestDialogOpen] = useState(false);
	const [moveDialogOpen, setMoveDialogOpen] = useState(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const handleToggleClose = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await setThreadClosed(threadId, !closed);
			toast.success(closed ? "主题已解锁" : "主题已关闭");
			router.refresh();
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "操作失败";
			setError(message);
			toast.error({ title: closed ? "解锁失败" : "关闭失败", description: message });
		} finally {
			setLoading(false);
		}
	}, [threadId, closed, router, toast]);

	// Recommend toggle — both verbs are idempotent on the worker (POST is
	// INSERT OR IGNORE, DELETE returns 200 on missing). The button only
	// drives label/action; the source of truth is `thread.isRecommended`
	// which refreshes after `router.refresh()`.
	const handleToggleRecommend = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (isRecommended) {
				await unrecommendThread(threadId);
				toast.success("已取消推荐");
			} else {
				await recommendThread(threadId);
				toast.success("已设为推荐");
			}
			router.refresh();
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "操作失败";
			setError(message);
			toast.error({
				title: isRecommended ? "取消推荐失败" : "推荐失败",
				description: message,
			});
		} finally {
			setLoading(false);
		}
	}, [threadId, isRecommended, router, toast]);

	const handleStickyChange = useCallback(
		async (level: StickyLevel) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadSticky(threadId, level);
				setStickyDialogOpen(false);
				toast.success("置顶已更新");
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "操作失败";
				setError(message);
				toast.error({ title: "置顶失败", description: message });
			} finally {
				setLoading(false);
			}
		},
		[threadId, router, toast],
	);

	const handleDigestChange = useCallback(
		async (level: number) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadDigest(threadId, level);
				setDigestDialogOpen(false);
				toast.success("精华已更新");
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "操作失败";
				setError(message);
				toast.error({ title: "精华设置失败", description: message });
			} finally {
				setLoading(false);
			}
		},
		[threadId, router, toast],
	);

	const handleHighlightChange = useCallback(
		async (options: HighlightOptions) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadHighlight(threadId, options);
				setHighlightDialogOpen(false);
				toast.success("高亮已更新");
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "操作失败";
				setError(message);
				toast.error({ title: "高亮设置失败", description: message });
			} finally {
				setLoading(false);
			}
		},
		[threadId, router, toast],
	);

	const handleMove = useCallback(
		async (targetForumId: number) => {
			setLoading(true);
			setError(null);
			try {
				await moveThread(threadId, targetForumId);
				setMoveDialogOpen(false);
				toast.success("主题已移动");
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "操作失败";
				setError(message);
				toast.error({ title: "移动失败", description: message });
			} finally {
				setLoading(false);
			}
		},
		[threadId, router, toast],
	);

	const handleDeleteClick = useCallback(() => {
		setError(null);
		setDeleteDialogOpen(true);
	}, []);

	const handleDeleteConfirm = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await deleteThread(threadId);
			setDeleteDialogOpen(false);
			toast.success("主题已删除");
			// Navigate back to forum after deletion
			router.push(`/forums/${forumId}`);
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败";
			setError(message);
			toast.error({ title: "删除失败", description: message });
			setLoading(false);
		}
	}, [threadId, forumId, router, toast]);

	// Don't render if user has no permissions
	if (!canManageThread && !canMoveThread && !canDeleteThread) {
		return null;
	}

	return (
		<>
			{/* Flat action bar */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
				{canManageThread && (
					<>
						<ForumActionButton
							icon={Pin}
							label="置顶"
							onClick={() => setStickyDialogOpen(true)}
							disabled={loading}
						/>
						<ForumActionButton
							icon={Highlighter}
							label="高亮"
							onClick={() => setHighlightDialogOpen(true)}
							disabled={loading}
						/>
						<ForumActionButton
							icon={Star}
							label="精华"
							onClick={() => setDigestDialogOpen(true)}
							disabled={loading}
						/>
						<ForumActionButton
							icon={BookmarkPlus}
							label={isRecommended ? "取消推荐" : "推荐"}
							onClick={handleToggleRecommend}
							disabled={loading}
						/>
						<ForumActionButton
							icon={closed ? LockOpen : Lock}
							label={closed ? "解锁" : "关闭"}
							onClick={handleToggleClose}
							disabled={loading}
						/>
					</>
				)}
				{canMoveThread && (
					<ForumActionButton
						icon={ArrowRight}
						label="移动"
						onClick={() => setMoveDialogOpen(true)}
						disabled={loading}
					/>
				)}
				{canDeleteThread && (
					<ForumActionButton
						icon={Trash2}
						label="删除"
						onClick={handleDeleteClick}
						disabled={loading}
						variant="destructive"
					/>
				)}
				{/* Error display */}
				{error && <span className="text-destructive">{error}</span>}
			</div>

			{/* Dialogs */}
			<StickyDialog
				open={stickyDialogOpen}
				onOpenChange={setStickyDialogOpen}
				currentLevel={sticky}
				onConfirm={handleStickyChange}
				loading={loading}
			/>
			<HighlightDialog
				open={highlightDialogOpen}
				onOpenChange={setHighlightDialogOpen}
				currentHighlight={highlight}
				onConfirm={handleHighlightChange}
				loading={loading}
			/>
			<DigestDialog
				open={digestDialogOpen}
				onOpenChange={setDigestDialogOpen}
				currentLevel={digest}
				onConfirm={handleDigestChange}
				loading={loading}
			/>
			<MoveDialog
				open={moveDialogOpen}
				onOpenChange={setMoveDialogOpen}
				currentForumId={forumId}
				onConfirm={handleMove}
				loading={loading}
			/>
			<ConfirmDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				title="删除主题"
				description={error ?? "确定要删除这个主题吗？此操作无法撤销，所有回复将被一同删除。"}
				confirmText="删除"
				variant="destructive"
				loading={loading}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}
