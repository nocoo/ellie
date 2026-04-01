// components/forum/post-card.tsx — Discuz classic two-column post card
// Desktop: left sidebar (user info) + vertical border + right content + action bar
// Mobile: compact header row + content
// Flat 1px solid border, no border-radius, cards stack with border-collapse.
//
// PostActionBar is passed as a prop into PostContent (not rendered as a sibling)
// to avoid hydration mismatches caused by unclosed HTML tags in post content.

"use client";

import { PostActionBar } from "@/components/forum/post-action-bar";
import { PostContent } from "@/components/forum/post-content";
import { PostEditDialog } from "@/components/forum/post-edit-dialog";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { ThreadModMenu } from "@/components/forum/thread-mod-menu";
import { UserPopover } from "@/components/forum/user-popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ApiError } from "@/lib/api-client";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { deleteMyPost, deletePost } from "@/lib/moderation-api";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { formatTime } from "@/viewmodels/forum/thread-list";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

interface PostCardProps {
	post: EnrichedPost;
	threadViews?: number;
	threadReplies?: number;
	threadDigest?: number;
	threadSticky?: number;
	threadHighlight?: number;
	threadClosed?: boolean;
	onReply?: () => void;
	canModerate: boolean;
	/** Can manage thread (sticky/highlight/digest/close) */
	canManageThread: boolean;
	/** Can move thread (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can delete thread (SuperMod/Admin or author) */
	canDeleteThread: boolean;
	currentUserId: number | null;
	/** Current viewer's role for popover permission checks */
	currentUserRole?: number;
	isFirstPost: boolean;
	threadId: number;
	forumId: number;
}

export function PostCard({
	post,
	threadViews,
	threadReplies,
	threadDigest,
	threadSticky,
	threadHighlight,
	threadClosed,
	onReply,
	canModerate,
	canManageThread,
	canMoveThread,
	canDeleteThread,
	currentUserId,
	currentUserRole = 0,
	isFirstPost,
	threadId,
	forumId,
}: PostCardProps) {
	const router = useRouter();
	const isFirst = post.isFirst || post.position === 1;
	const isOwnPost = currentUserId !== null && post.authorId === currentUserId;

	// Can edit: author or moderator
	const canEdit = post.canEdit;
	// Can delete: author or SuperMod/Admin (per permission model)
	const canDelete = post.canDelete;

	// Edit dialog state
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [_deleting, setDeleting] = useState(false);

	const handleEdit = useCallback(() => {
		setEditDialogOpen(true);
	}, []);

	const handleDelete = useCallback(async () => {
		if (!confirm("确定要删除这条回复吗？此操作无法撤销。")) {
			return;
		}

		setDeleting(true);
		try {
			// Use user self-service API if own post, otherwise moderation API
			if (isOwnPost) {
				await deleteMyPost(post.id);
			} else if (canModerate) {
				await deletePost(post.id);
			}
			router.refresh();
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "删除失败";
			alert(message);
		} finally {
			setDeleting(false);
		}
	}, [post.id, isOwnPost, canModerate, router]);

	const actionBar = (
		<>
			<PostActionBar
				onReply={onReply}
				onEdit={canEdit ? handleEdit : undefined}
				onDelete={canDelete && !isFirst ? handleDelete : undefined}
				canEdit={canEdit}
				canDelete={canDelete && !isFirst}
			/>
			{/* Thread mod menu: only on first post, for users with any management permission */}
			{isFirstPost && (canManageThread || canMoveThread || canDeleteThread) && (
				<div className="flex items-center gap-2 border-t border-dashed border-border bg-muted/30 px-3 py-1.5">
					<span className="text-xs text-muted-foreground">管理操作</span>
					<ThreadModMenu
						threadId={threadId}
						forumId={forumId}
						sticky={threadSticky ?? 0}
						digest={threadDigest ?? 0}
						highlight={threadHighlight ?? 0}
						closed={threadClosed ?? false}
						canManageThread={canManageThread}
						canMoveThread={canMoveThread}
						canDeleteThread={canDeleteThread}
					/>
				</div>
			)}
		</>
	);

	return (
		<div className="border border-border bg-card -mt-px first:mt-0">
			{/* Desktop: two-column layout */}
			<div className="hidden md:flex">
				<PostSidebar
					author={post.author}
					isFirst={isFirst}
					threadViews={threadViews}
					threadReplies={threadReplies}
					canModerate={canModerate}
					viewerRole={currentUserRole}
					viewerUserId={currentUserId}
				/>
				<PostContent
					post={post}
					isFirst={isFirst}
					threadDigest={threadDigest}
					author={post.author}
					actionBar={actionBar}
				/>
			</div>

			{/* Mobile: compact single-column layout */}
			<div className="md:hidden">
				{/* Compact header row */}
				<div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-dashed border-border">
					<UserPopover
						userId={post.authorId}
						viewerRole={currentUserRole}
						viewerUserId={currentUserId}
						disabled={!post.author}
					>
						<Avatar className="h-8 w-8 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)] cursor-pointer">
							{post.author && (
								<AvatarImage
									src={getAvatarUrl(post.authorId, "small")}
									alt={post.author.username}
									className="rounded-sm"
								/>
							)}
							<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
								<img
									src={getStaticImageUrl("tavatar.gif")}
									alt=""
									className="h-full w-full object-cover"
								/>
							</AvatarFallback>
						</Avatar>
					</UserPopover>
					<div className="flex flex-col min-w-0">
						<UserPopover
							userId={post.authorId}
							viewerRole={currentUserRole}
							viewerUserId={currentUserId}
							disabled={!post.author}
						>
							<span className="text-sm font-medium text-forum-link hover:underline truncate cursor-pointer">
								{post.author?.username ?? "未知用户"}
							</span>
						</UserPopover>
						<span className="text-2xs text-forum-text-muted">{formatTime(post.createdAt)}</span>
					</div>
					<span className="ml-auto text-xs font-medium text-muted-foreground shrink-0">
						{floorLabel(post.position, isFirst)}
						<sup className="text-2xs">#</sup>
					</span>
				</div>

				<PostContent
					post={post}
					isFirst={isFirst}
					threadDigest={threadDigest}
					author={post.author}
					actionBar={actionBar}
				/>
			</div>

			{/* Edit dialog */}
			<PostEditDialog
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
				postId={post.id}
				currentContent={post.content}
				isOwnPost={isOwnPost}
				canModerate={canModerate}
			/>
		</div>
	);
}
