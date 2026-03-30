// components/forum/post-card.tsx — Post card with inline author header
// Ref: 04f §7 — removed 120px sidebar, author info as compact header row

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { type EnrichedPost, floorLabel, formatFileSize } from "@/viewmodels/forum/thread-detail";
import { formatTime } from "@/viewmodels/forum/thread-list";
import Link from "next/link";

interface PostCardProps {
	post: EnrichedPost;
}

function authorInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

export function PostCard({ post }: PostCardProps) {
	const isFirst = post.isFirst || post.position === 1;

	return (
		<Card size="sm">
			<CardContent className="pt-3">
				{/* Author + meta header */}
				<div className="flex items-center gap-2 pb-2 border-b border-border/50">
					<Link href={`/users/${post.authorId}`}>
						<Avatar className="h-6 w-6">
							<AvatarFallback className="text-[10px]">
								{post.author ? authorInitials(post.author.username) : "?"}
							</AvatarFallback>
						</Avatar>
					</Link>
					<Link
						href={`/users/${post.authorId}`}
						className="text-sm font-medium text-foreground hover:text-primary transition-colors"
					>
						{post.author?.username ?? "未知用户"}
					</Link>
					<span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>
					{post.author && (
						<span className="hidden sm:inline text-[10px] text-muted-foreground">
							帖子 {post.author.posts.toLocaleString()}
						</span>
					)}
					<span className="ml-auto text-xs font-medium text-muted-foreground">
						{floorLabel(post.position, isFirst)}
					</span>
				</div>

				{/* Post content */}
				<div
					className="mt-3 prose prose-sm max-w-none text-foreground"
					dangerouslySetInnerHTML={{ __html: post.content }}
				/>

				{/* Attachments */}
				{post.attachments.length > 0 && (
					<div className="mt-3 space-y-1.5">
						{post.attachments.map((att) => (
							<div
								key={att.id}
								className="flex items-center gap-2 rounded-lg bg-background p-2 text-xs"
							>
								{att.isImage ? (
									<a href={att.filePath} target="_blank" rel="noopener noreferrer">
										<img
											src={att.hasThumb ? `${att.filePath}.thumb.jpg` : att.filePath}
											alt={att.filename}
											className="max-h-20 rounded"
										/>
									</a>
								) : (
									<>
										<span className="text-muted-foreground">📎</span>
										<span className="truncate">{att.filename}</span>
										<span className="text-muted-foreground shrink-0">
											{formatFileSize(att.fileSize)}
										</span>
									</>
								)}
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
