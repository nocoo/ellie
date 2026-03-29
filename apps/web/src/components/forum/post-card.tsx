// components/forum/post-card.tsx — Single post card (floor display)
// Ref: 04d §PostCard — author sidebar + content + attachments + floor number

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
		<div className="flex gap-4 rounded-[10px] bg-secondary p-4">
			{/* Author sidebar */}
			<div className="hidden sm:flex flex-col items-center gap-2 w-[120px] shrink-0">
				<Link href={`/users/${post.authorId}`}>
					<Avatar className="h-12 w-12">
						<AvatarFallback className="text-xs">
							{post.author ? authorInitials(post.author.username) : "?"}
						</AvatarFallback>
					</Avatar>
				</Link>
				<Link
					href={`/users/${post.authorId}`}
					className="text-xs font-medium text-foreground hover:text-primary transition-colors text-center"
				>
					{post.author?.username ?? "未知用户"}
				</Link>
				{post.author && (
					<span className="text-[10px] text-muted-foreground">
						帖子 {post.author.posts.toLocaleString()}
					</span>
				)}
			</div>

			{/* Content area */}
			<div className="min-w-0 flex-1">
				{/* Mobile author row */}
				<div className="sm:hidden flex items-center gap-2 mb-2">
					<Link
						href={`/users/${post.authorId}`}
						className="text-xs font-medium text-foreground hover:text-primary"
					>
						{post.author?.username ?? "未知用户"}
					</Link>
				</div>

				{/* Post header */}
				<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
					<span>{formatTime(post.createdAt)}</span>
					<span className="font-medium">{floorLabel(post.position, isFirst)}</span>
				</div>

				{/* Post content */}
				<div
					className="mt-3 prose prose-sm max-w-none text-foreground"
					dangerouslySetInnerHTML={{ __html: post.content }}
				/>

				{/* Attachments */}
				{post.attachments.length > 0 && (
					<div className="mt-4 space-y-2">
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
			</div>
		</div>
	);
}
