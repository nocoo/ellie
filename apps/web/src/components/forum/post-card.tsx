// components/forum/post-card.tsx — Discuz classic two-column post card (View layer)
// Desktop: left sidebar (user info) + vertical border + right content + action bar
// Mobile: compact header row + content
// Flat 1px solid border, no border-radius, cards stack with border-collapse.
//
// PostActionBar is passed as a prop into PostContent (not rendered as a sibling)
// to avoid hydration mismatches caused by unclosed HTML tags in post content.
//
// MVVM: This is the View layer. State and logic are in usePostActions hook.

"use client";

import { PostActionBar } from "@/components/forum/post-action-bar";
import { PostAuthorStatusIcon } from "@/components/forum/post-author-status-icon";
import { PostComments } from "@/components/forum/post-comments";
import { PostContent } from "@/components/forum/post-content";
import { PostEditDialog } from "@/components/forum/post-edit-dialog";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { ReportDialog } from "@/components/forum/report-dialog";
import { ThreadModMenu } from "@/components/forum/thread-mod-menu";
import { ForumAvatar } from "@/components/forum/user-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getStaticImageUrl } from "@/lib/cdn";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { usePostActions } from "@/viewmodels/forum/use-post-actions";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import Link from "next/link";
import { useState } from "react";

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
	isFirstPost: boolean;
	threadId: number;
	forumId: number;
	/** Original thread starter's user id (for楼主 icon resolution). */
	threadAuthorId: number;
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
	isFirstPost,
	threadId,
	forumId,
	threadAuthorId,
}: PostCardProps) {
	const isFirst = post.isFirst || post.position === 1;
	const isOwnPost = currentUserId !== null && post.authorId === currentUserId;

	// Can edit: author or moderator
	const canEdit = post.canEdit;
	// Can delete: author or SuperMod/Admin (per permission model)
	const canDelete = post.canDelete;

	// Use ViewModel hook for post actions
	const { state, actions } = usePostActions({
		postId: post.id,
		isOwnPost,
		canModerate,
	});

	// Report dialog state
	const [reportDialogOpen, setReportDialogOpen] = useState(false);
	// Comment dialog state
	const [commentDialogOpen, setCommentDialogOpen] = useState(false);
	// Can report: logged in and not own post
	const canReport = currentUserId !== null && !isOwnPost;
	// Can comment: logged in and thread not closed
	const canComment = currentUserId !== null && !threadClosed;

	const actionBar = (
		<>
			<PostActionBar
				onReply={onReply}
				onComment={canComment ? () => setCommentDialogOpen(true) : undefined}
				onEdit={canEdit ? actions.handleEdit : undefined}
				onDelete={canDelete && !isFirst ? actions.handleDeleteClick : undefined}
				onReport={canReport ? () => setReportDialogOpen(true) : undefined}
				canEdit={canEdit}
				canDelete={canDelete && !isFirst}
				canReport={canReport}
				canComment={canComment}
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

	const commentsSection = (
		<PostComments
			postId={post.id}
			threadClosed={threadClosed}
			isLoggedIn={currentUserId !== null}
			dialogOpen={commentDialogOpen}
			onDialogOpenChange={setCommentDialogOpen}
		/>
	);

	return (
		<div id={`post-${post.id}`} className="border border-border bg-card -mt-px first:mt-0">
			{/* Desktop: two-column layout */}
			<div className="hidden md:flex">
				<PostSidebar
					author={post.author}
					isFirst={isFirst}
					threadViews={threadViews}
					threadReplies={threadReplies}
				/>
				<div className="flex-1 min-w-0 flex flex-col">
					<PostContent
						post={post}
						isFirst={isFirst}
						threadDigest={threadDigest}
						threadAuthorId={threadAuthorId}
						author={post.author}
						actionBar={actionBar}
						comments={commentsSection}
					/>
				</div>
			</div>
			{/* Mobile: compact single-column layout */}
			<div className="md:hidden">
				{/* Compact header row */}
				<div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-dashed border-border">
					{post.author ? (
						<Link href={`/users/${post.authorId}`} prefetch={false}>
							<ForumAvatar
								userId={post.authorId}
								userName={post.author.username}
								avatarPath={post.author.avatarPath}
								size="md"
								className="shadow-[0_0_2px_rgba(0,0,0,0.15)]"
							/>
						</Link>
					) : (
						<Avatar className="h-8 w-8 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
							<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
								<img
									src={getStaticImageUrl("tavatar.gif")}
									alt=""
									className="h-full w-full object-cover"
								/>
							</AvatarFallback>
						</Avatar>
					)}
					<div className="flex flex-col min-w-0">
						{post.author ? (
							<Link
								href={`/users/${post.authorId}`}
								prefetch={false}
								className="text-sm font-medium text-forum-link hover:underline truncate"
							>
								{post.author.username}
							</Link>
						) : (
							<span className="text-sm font-medium text-muted-foreground truncate">未知用户</span>
						)}
						<span className="text-2xs text-muted-foreground flex items-center gap-1">
							<PostAuthorStatusIcon
								role={post.author?.role}
								isThreadAuthor={post.author?.id !== undefined && post.author.id === threadAuthorId}
								className="h-3.5 w-3.5 shrink-0"
							/>
							{formatRelativeTime(post.createdAt)}
						</span>
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
					threadAuthorId={threadAuthorId}
					author={post.author}
					actionBar={actionBar}
					comments={commentsSection}
				/>
			</div>
			{/* Edit dialog */}
			<PostEditDialog
				open={state.editDialogOpen}
				onOpenChange={actions.handleEditClose}
				postId={post.id}
				currentContent={post.content}
				isOwnPost={isOwnPost}
				canModerate={canModerate}
			/>
			{/* Delete confirmation dialog */}
			<ConfirmDialog
				open={state.deleteDialogOpen}
				onOpenChange={actions.handleDeleteClose}
				title="删除回复"
				description={state.deleteError ?? "确定要删除这条回复吗？此操作无法撤销。"}
				confirmText="删除"
				variant="destructive"
				loading={state.deleting}
				onConfirm={actions.handleDeleteConfirm}
			/>
			{/* Report dialog */}
			<ReportDialog
				open={reportDialogOpen}
				onOpenChange={setReportDialogOpen}
				targetType="post"
				targetId={post.id}
			/>
		</div>
	);
}
