"use client";

// components/forum/thread-mod-menu.tsx — Thread moderation dropdown menu
// Positioned at the bottom of the first post for users with moderation permissions

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ArrowRight, Highlighter, Lock, LockOpen, Pin, Settings, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { DigestDialog } from "./digest-dialog";
import { HighlightDialog } from "./highlight-dialog";
import { MoveDialog } from "./move-dialog";
import { StickyDialog } from "./sticky-dialog";

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

	const handleDelete = useCallback(async () => {
		if (!confirm("确定要删除这个主题吗？此操作无法撤销，所有回复将被一同删除。")) {
			return;
		}

		setLoading(true);
		setError(null);
		try {
			await deleteThread(threadId);
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
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button size="sm" variant="outline" disabled={loading} className="gap-1">
							<Settings className="h-3.5 w-3.5" />
							<span>管理</span>
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="min-w-[140px]">
					{canManageThread && (
						<>
							<DropdownMenuItem onClick={() => setStickyDialogOpen(true)}>
								<Pin className="h-4 w-4" />
								置顶...
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setHighlightDialogOpen(true)}>
								<Highlighter className="h-4 w-4" />
								高亮...
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setDigestDialogOpen(true)}>
								<Star className="h-4 w-4" />
								精华...
							</DropdownMenuItem>
							<DropdownMenuItem onClick={handleToggleClose} disabled={loading}>
								{closed ? (
									<>
										<LockOpen className="h-4 w-4" />
										解锁主题
									</>
								) : (
									<>
										<Lock className="h-4 w-4" />
										关闭主题
									</>
								)}
							</DropdownMenuItem>
						</>
					)}
					{canMoveThread && (
						<DropdownMenuItem onClick={() => setMoveDialogOpen(true)}>
							<ArrowRight className="h-4 w-4" />
							移动...
						</DropdownMenuItem>
					)}
					{canDeleteThread && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={handleDelete} disabled={loading}>
								<Trash2 className="h-4 w-4" />
								删除主题
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Error display */}
			{error && <span className="text-xs text-destructive ml-2">{error}</span>}

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
		</>
	);
}
