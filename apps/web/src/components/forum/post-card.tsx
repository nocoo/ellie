// components/forum/post-card.tsx — Discuz classic two-column post card
// Desktop: left sidebar (user info) + vertical separator + right content
// Mobile: compact header row + content

import { PostContent } from "@/components/forum/post-content";
import { PostSidebar } from "@/components/forum/post-sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { type EnrichedPost, floorLabel } from "@/viewmodels/forum/thread-detail";
import { formatTime } from "@/viewmodels/forum/thread-list";
import Link from "next/link";

interface PostCardProps {
	post: EnrichedPost;
	threadViews?: number;
	threadReplies?: number;
	threadDigest?: number;
}

function authorInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

export function PostCard({ post, threadViews, threadReplies, threadDigest }: PostCardProps) {
	const isFirst = post.isFirst || post.position === 1;

	return (
		<Card size="sm" className="overflow-hidden !py-0 !gap-0">
			{/* Desktop: two-column layout */}
			<div className="hidden md:flex flex-row">
				<PostSidebar
					author={post.author}
					isFirst={isFirst}
					threadViews={threadViews}
					threadReplies={threadReplies}
				/>
				<Separator orientation="vertical" />
				<PostContent post={post} isFirst={isFirst} threadDigest={threadDigest} />
			</div>

			{/* Mobile: compact single-column layout */}
			<div className="md:hidden">
				{/* Compact header row */}
				<div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border/50">
					<Link href={`/users/${post.authorId}`}>
						<Avatar className="h-8 w-8">
							<AvatarFallback className="text-xs">
								{post.author ? authorInitials(post.author.username) : "?"}
							</AvatarFallback>
						</Avatar>
					</Link>
					<div className="flex flex-col min-w-0">
						<Link
							href={`/users/${post.authorId}`}
							className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
						>
							{post.author?.username ?? "未知用户"}
						</Link>
						<span className="text-[10px] text-muted-foreground">{formatTime(post.createdAt)}</span>
					</div>
					<span className="ml-auto text-xs font-medium text-muted-foreground shrink-0">
						{floorLabel(post.position, isFirst)}
					</span>
				</div>

				{/* Content (reuse PostContent, no meta bar duplication needed for mobile) */}
				<PostContent post={post} isFirst={isFirst} threadDigest={threadDigest} />
			</div>
		</Card>
	);
}
