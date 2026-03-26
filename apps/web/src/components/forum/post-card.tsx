// components/forum/post-card.tsx — Single post/reply card
// Ref: 04d §PostCard — author info + content + floor number + attachments

import type { Attachment, Post, User } from "@ellie/types";
import { formatRelativeTime } from "./forum-card";
import { UserCard } from "./user-card";

export interface PostCardProps {
	post: Post;
	author: User | null;
	attachments: Attachment[];
	floorNumber: number;
}

/**
 * Compute floor label (1F = main post, 2F+ = replies).
 * Pure function, exported for testing.
 */
export function getFloorLabel(position: number): string {
	return `${position}F`;
}

export function PostCard({ post, author, attachments, floorNumber }: PostCardProps) {
	return (
		<div className="rounded-[10px] bg-secondary p-4">
			<div className="flex gap-4">
				{/* Author sidebar — hidden on mobile */}
				<div className="hidden sm:block">
					<UserCard user={author} authorName={post.authorName} authorId={post.authorId} />
				</div>

				{/* Content area */}
				<div className="min-w-0 flex-1">
					{/* Floor header */}
					<div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
						<span className="font-medium">{getFloorLabel(floorNumber)}</span>
						<span>{formatRelativeTime(post.createdAt)}</span>
					</div>

					{/* Mobile author line */}
					<div className="mb-2 flex items-center gap-2 text-sm sm:hidden">
						<span className="font-medium">{post.authorName}</span>
					</div>

					{/* Post content */}
					<PostContent html={post.content} />

					{/* Attachments */}
					{attachments.length > 0 && (
						<div className="mt-3 space-y-2 border-t pt-3">
							<div className="text-xs font-medium text-muted-foreground">
								Attachments ({attachments.length})
							</div>
							<div className="flex flex-wrap gap-2">
								{attachments.map((att) => (
									<div key={att.id} className="text-xs text-muted-foreground">
										{att.isImage ? "📷" : "📎"} {att.filename} ({formatFileSize(att.fileSize)})
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Format file size in bytes to human-readable string.
 * Pure function, exported for testing.
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders sanitized HTML content for a post.
 * Content is pre-sanitized at migration/write time per 04a §Sanitize Rules.
 */
function PostContent({ html }: { html: string }) {
	return (
		<div
			className="prose prose-sm max-w-none dark:prose-invert"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
