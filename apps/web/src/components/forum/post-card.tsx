// components/forum/post-card.tsx — Discuz classic two-column post card
// Desktop: left sidebar (user info) + vertical border + right content + action bar
// Mobile: compact header row + content
// Flat 1px solid border, no border-radius, cards stack with border-collapse.
//
// PostActionBar is passed as a prop into PostContent (not rendered as a sibling)
// to avoid hydration mismatches caused by unclosed HTML tags in post content.

import { PostActionBar } from "@/components/forum/post-action-bar";
import { PostContent } from "@/components/forum/post-content";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { formatTime } from "@/viewmodels/forum/thread-list";
import { UserRound } from "lucide-react";
import Link from "next/link";

interface PostCardProps {
	post: EnrichedPost;
	threadViews?: number;
	threadReplies?: number;
	threadDigest?: number;
}

const actionBar = <PostActionBar />;

export function PostCard({ post, threadViews, threadReplies, threadDigest }: PostCardProps) {
	const isFirst = post.isFirst || post.position === 1;

	return (
		<div className="border border-[#CFCFCF] bg-white -mt-px first:mt-0">
			{/* Desktop: two-column layout */}
			<div className="hidden md:flex">
				<PostSidebar
					author={post.author}
					isFirst={isFirst}
					threadViews={threadViews}
					threadReplies={threadReplies}
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
				<div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-dashed border-[#CCC]">
					<Link href={`/users/${post.authorId}`}>
						<Avatar className="h-8 w-8 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
							{post.author && (
								<AvatarImage
									src={getAvatarUrl(post.authorId, "small")}
									alt={post.author.username}
									className="rounded-sm"
								/>
							)}
							<AvatarFallback className="text-xs rounded-sm bg-[#F0F0F0]">
								<UserRound className="h-5 w-5 text-[#BBB]" strokeWidth={1.2} />
							</AvatarFallback>
						</Avatar>
					</Link>
					<div className="flex flex-col min-w-0">
						<Link
							href={`/users/${post.authorId}`}
							className="text-sm font-medium text-[#3672A0] hover:underline truncate"
						>
							{post.author?.username ?? "未知用户"}
						</Link>
						<span className="text-[10px] text-[#999]">{formatTime(post.createdAt)}</span>
					</div>
					<span className="ml-auto text-xs font-medium text-[#666] shrink-0">
						{floorLabel(post.position, isFirst)}
						<sup className="text-[10px]">#</sup>
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
