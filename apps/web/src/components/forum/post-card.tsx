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
import { PostRatingDialog } from "@/components/forum/post-rating-dialog";
import { PostRatingSummary } from "@/components/forum/post-rating-summary";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { ReportDialog } from "@/components/forum/report-dialog";
import { ForumAvatar } from "@/components/forum/user-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getStaticImageUrl } from "@/lib/cdn";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { usePostActions } from "@/viewmodels/forum/use-post-actions";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import {
	EMPTY_RATING_AGGREGATE,
	type PostRatingAggregate,
	RatingDimension,
	type UserRole,
	canRateDimension,
} from "@ellie/types";
import Link from "next/link";
import { useState } from "react";

interface PostCardProps {
	post: EnrichedPost;
	threadViews?: number;
	threadReplies?: number;
	threadDigest?: number;
	threadClosed?: boolean;
	onReply?: () => void;
	canModerate: boolean;
	currentUserId: number | null;
	/**
	 * Real session role of the current viewer (server-projected via NextAuth
	 * cookie). `null` for anonymous or when the loader couldn't resolve it.
	 * Drives the `same钱 / 积分` action-bar entries — Worker still enforces
	 * the gate, this only decides which entry to render and what default
	 * dimension the dialog opens with.
	 */
	currentUserRole: UserRole | null;
	/**
	 * Server-projected `emailVerifiedAt` of the current viewer. `0` means
	 * unverified (write-gate blocks), positive means verified, `null` means
	 * anonymous or fail-soft. Passed through to `writeGatePreflight` for
	 * the rating entry (same semantics as reply/thread).
	 */
	selfEmailVerifiedAt: number | null;
	/** Original thread starter's user id (for楼主 icon resolution). */
	threadAuthorId: number;
}

export function PostCard({
	post,
	threadViews,
	threadReplies,
	threadDigest,
	threadClosed,
	onReply,
	canModerate,
	currentUserId,
	currentUserRole,
	selfEmailVerifiedAt,
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
	// Rating dialog state — `dimension` stages which tab opens (action-bar
	// entry pre-selects 同钱/积分); the dialog locks the toggle if the
	// viewer can't rate the other dimension.
	const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
	const [ratingDialogDimension, setRatingDialogDimension] = useState<RatingDimension>(
		RatingDimension.Coins,
	);
	// Rating aggregate state — seeded from SSR enrichment, refreshed
	// optimistically on successful create. The detail popover owns its own
	// fresh aggregate from `GET /:id/ratings` to keep revoke math consistent.
	const [ratingAggregate, setRatingAggregate] = useState<PostRatingAggregate>(
		post.ratingAggregate ?? EMPTY_RATING_AGGREGATE,
	);
	// Can report: logged in and not own post
	const canReport = currentUserId !== null && !isOwnPost;
	// Can comment: logged in and thread not closed
	const canComment = currentUserId !== null && !threadClosed;

	// Rating entry visibility (docs/22 §7.1):
	//  - Logged in, non-self, non-anonymous author (authorId > 0).
	//    `invisible` is server-filtered before the row reaches the client,
	//    so we don't re-check it here.
	//  - 同钱 is open to every authenticated role; 积分 additionally needs
	//    role ∈ {Mod, SuperMod, Admin}.
	//  - Email-unverified users still see the entry; the dialog (via
	//    `writeGatePreflight`) surfaces §5.4 verbatim instead of silently
	//    hiding the feature.
	const isRateableTarget = currentUserId !== null && !isOwnPost && post.authorId > 0;
	const canRateCoins = isRateableTarget;
	const canRateCredits =
		isRateableTarget &&
		currentUserRole !== null &&
		canRateDimension(currentUserRole, RatingDimension.Credits);

	const openRatingDialog = async (dimension: RatingDimension) => {
		// Write-gate preflight — handles email verification + posting
		// restrictions. The dispatched dialog matches reply/comment/report so
		// users get the same §5.4 / posting-restriction copy across surfaces.
		if (await writeGatePreflight(selfEmailVerifiedAt, "rating")) return;
		setRatingDialogDimension(dimension);
		setRatingDialogOpen(true);
	};

	const actionBar = (
		<PostActionBar
			onReply={onReply}
			onComment={
				canComment
					? async () => {
							if (await writeGatePreflight(null, "comment")) return;
							setCommentDialogOpen(true);
						}
					: undefined
			}
			onRateCoins={canRateCoins ? () => openRatingDialog(RatingDimension.Coins) : undefined}
			onRateCredits={canRateCredits ? () => openRatingDialog(RatingDimension.Credits) : undefined}
			onEdit={canEdit ? actions.handleEdit : undefined}
			onDelete={canDelete && !isFirst ? actions.handleDeleteClick : undefined}
			onReport={
				canReport
					? async () => {
							if (await writeGatePreflight(null, "report")) return;
							setReportDialogOpen(true);
						}
					: undefined
			}
			canEdit={canEdit}
			canDelete={canDelete && !isFirst}
			canReport={canReport}
			canComment={canComment}
			canRateCoins={canRateCoins}
			canRateCredits={canRateCredits}
		/>
	);

	const commentsSection = (
		<PostComments
			postId={post.id}
			threadClosed={threadClosed}
			isLoggedIn={currentUserId !== null}
			initialComments={post.comments}
			dialogOpen={commentDialogOpen}
			onDialogOpenChange={setCommentDialogOpen}
		/>
	);

	// Rating summary — only rendered when at least one un-revoked rating
	// exists. Detail popover lazy-fetches its own up-to-date aggregate to
	// keep revoke math in sync even after multiple optimistic updates.
	const ratingSummary =
		ratingAggregate.total > 0 ? (
			<PostRatingSummary postId={post.id} aggregate={ratingAggregate} />
		) : null;

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
						ratingSummary={ratingSummary}
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
								className="shadow-[0_0_2px_rgba(0,0,0,0.15)] dark:shadow-[0_0_2px_rgba(255,255,255,0.10)]"
							/>
						</Link>
					) : (
						<Avatar className="h-8 w-8 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)] dark:shadow-[0_0_2px_rgba(255,255,255,0.10)]">
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
								className="text-xs font-medium text-forum-link hover:underline truncate"
								data-testid="post-card-mobile-author"
							>
								{post.author.username}
							</Link>
						) : (
							<span
								className="text-xs font-medium text-muted-foreground truncate"
								data-testid="post-card-mobile-author"
							>
								未知用户
							</span>
						)}
						<span
							className="text-xs text-muted-foreground flex items-center gap-1"
							data-testid="post-card-mobile-time"
						>
							<PostAuthorStatusIcon
								role={post.author?.role}
								isThreadAuthor={post.author?.id !== undefined && post.author.id === threadAuthorId}
							/>
							{formatRelativeTime(post.createdAt)}
						</span>
					</div>
					<span
						className="ml-auto text-xs font-medium text-muted-foreground shrink-0"
						data-testid="post-card-mobile-floor"
					>
						{floorLabel(post.position, isFirst)}
						<sup className="text-xs">#</sup>
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
					ratingSummary={ratingSummary}
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
			{/*
			 * PostRatingDialog — coins/credits entry from the action-bar.
			 * Permission only decides the entry visibility + default
			 * dimension; Worker is the final 403/EMAIL_NOT_VERIFIED gate.
			 * Phase 4.4 will mount PostRatingSummary alongside so the
			 * aggregate refreshes after `onSuccess` fires.
			 */}
			{isRateableTarget && (
				<PostRatingDialog
					open={ratingDialogOpen}
					onOpenChange={setRatingDialogOpen}
					postId={post.id}
					defaultDimension={ratingDialogDimension}
					canRateCredits={canRateCredits}
					onSuccess={(response) => setRatingAggregate(response.aggregate)}
				/>
			)}
		</div>
	);
}
