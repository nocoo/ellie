// components/forum/post-card.tsx — Discuz classic two-column post card
// Desktop: left sidebar (user info) + vertical border + right content + action bar
// Mobile: compact header row + content
// Flat 1px solid border, no border-radius, cards stack with border-collapse.
//
// PostActionBar is passed as a prop into PostContent (not rendered as a sibling)
// to avoid hydration mismatches caused by unclosed HTML tags in post content.

import { ModActionBar } from "@/components/forum/mod-action-bar";
import { PostActionBar } from "@/components/forum/post-action-bar";
import { PostContent } from "@/components/forum/post-content";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { formatTime } from "@/viewmodels/forum/thread-list";
import Link from "next/link";

interface PostCardProps {
	post: EnrichedPost;
	threadViews?: number;
	threadReplies?: number;
	threadDigest?: number;
	onReply?: () => void;
	canModerate: boolean;
	currentUserId: number | null;
	isFirstPost: boolean;
	threadId: number;
	forumId: number;
}

export function PostCard({
	post,
	threadViews,
	threadReplies,
	threadDigest,
	onReply,
	canModerate,
	currentUserId: _currentUserId,
	isFirstPost,
	threadId,
	forumId,
}: PostCardProps) {
	const isFirst = post.isFirst || post.position === 1;

	// Can edit: author or moderator
	const canEdit = post.canEdit;

	const actionBar = (
		<>
			<PostActionBar onReply={onReply} canModerate={canModerate} canEdit={canEdit} />
			{/* Mod action bar: only on first post, only for moderators */}
			{isFirstPost && canModerate && <ModActionBar forumId={forumId} threadId={threadId} />}
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
					<Link href={`/users/${post.authorId}`}>
						<Avatar className="h-8 w-8 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
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
					</Link>
					<div className="flex flex-col min-w-0">
						<Link
							href={`/users/${post.authorId}`}
							className="text-sm font-medium text-forum-link hover:underline truncate"
						>
							{post.author?.username ?? "未知用户"}
						</Link>
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
		</div>
	);
}
