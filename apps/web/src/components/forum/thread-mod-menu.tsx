"use client";

// components/forum/thread-mod-menu.tsx — Thread moderation action bar
// Flat inline buttons positioned at the bottom of the first post

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError } from "@/lib/api-client";
import {
	type HighlightOptions,
	type StickyLevel,
	deleteThread,
	moveThread,
	setThreadClosed,
	setThreadDigest,
	setThreadHighlight,
	setThreadSticky,
} from "@/lib/moderation-api";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Highlighter, Lock, LockOpen, Pin, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { DigestDialog } from "./digest-dialog";
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
	/** Can user manage thread (sticky/highlight/digest/close)? */
	canManageThread: boolean;
	/** Can user move thread? (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can user delete thread? (SuperMod/Admin or author) */
	canDeleteThread: boolean;
}

// ---------------------------------------------------------------------------
// Action Button
// ---------------------------------------------------------------------------

interface ActionBtnProps {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	variant?: "default" | "destructive";
}

function ActionBtn({ icon: Icon, label, onClick, disabled, variant = "default" }: ActionBtnProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex items-center gap-0.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
				variant === "destructive"
					? "text-destructive/70 hover:text-destructive"
					: "text-forum-text-muted hover:text-forum-link"
			}`}
		>
			<Icon className="h-3.5 w-3.5" />
			<span>{label}</span>
		</button>
	);
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
	canManageThread,
	canMoveThread,
	canDeleteThread,
}: ThreadModMenuProps) {
	const router = useRouter();
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
			router.refresh();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "操作失败");
		} finally {
			setLoading(false);
		}
	}, [threadId, closed, router]);

	const handleStickyChange = useCallback(
		async (level: StickyLevel) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadSticky(threadId, level);
				setStickyDialogOpen(false);
				router.refresh();
			} catch (err) {
				setError(err instanceof ApiError ? err.message : "操作失败");
			} finally {
				setLoading(false);
			}
		},
		[threadId, router],
	);

	const handleDigestChange = useCallback(
		async (level: number) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadDigest(threadId, level);
				setDigestDialogOpen(false);
				router.refresh();
			} catch (err) {
				setError(err instanceof ApiError ? err.message : "操作失败");
			} finally {
				setLoading(false);
			}
		},
		[threadId, router],
	);

	const handleHighlightChange = useCallback(
		async (options: HighlightOptions) => {
			setLoading(true);
			setError(null);
			try {
				await setThreadHighlight(threadId, options);
				setHighlightDialogOpen(false);
				router.refresh();
			} catch (err) {
				setError(err instanceof ApiError ? err.message : "操作失败");
			} finally {
				setLoading(false);
			}
		},
		[threadId, router],
	);

	const handleMove = useCallback(
		async (targetForumId: number) => {
			setLoading(true);
			setError(null);
			try {
				await moveThread(threadId, targetForumId);
				setMoveDialogOpen(false);
				router.refresh();
			} catch (err) {
				setError(err instanceof ApiError ? err.message : "操作失败");
			} finally {
				setLoading(false);
			}
		},
		[threadId, router],
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
			// Navigate back to forum after deletion
			router.push(`/forums/${forumId}`);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "删除失败");
			setLoading(false);
		}
	}, [threadId, forumId, router]);

	// Don't render if user has no permissions
	if (!canManageThread && !canMoveThread && !canDeleteThread) {
		return null;
	}

	return (
		<>
			{/* Flat action bar */}
			<div className="flex items-center gap-4 text-xs">
				{canManageThread && (
					<>
						<ActionBtn
							icon={Pin}
							label="置顶"
							onClick={() => setStickyDialogOpen(true)}
							disabled={loading}
						/>
						<ActionBtn
							icon={Highlighter}
							label="高亮"
							onClick={() => setHighlightDialogOpen(true)}
							disabled={loading}
						/>
						<ActionBtn
							icon={Star}
							label="精华"
							onClick={() => setDigestDialogOpen(true)}
							disabled={loading}
						/>
						<ActionBtn
							icon={closed ? LockOpen : Lock}
							label={closed ? "解锁" : "关闭"}
							onClick={handleToggleClose}
							disabled={loading}
						/>
					</>
				)}
				{canMoveThread && (
					<ActionBtn
						icon={ArrowRight}
						label="移动"
						onClick={() => setMoveDialogOpen(true)}
						disabled={loading}
					/>
				)}
				{canDeleteThread && (
					<ActionBtn
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
