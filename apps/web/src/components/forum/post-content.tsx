// components/forum/post-content.tsx — Right-side post content area
// Meta bar (time + digest badge + floor), HTML content, attachments

import { Badge } from "@/components/ui/badge";
import {
	type EnrichedPost,
	floorLabel,
	formatDateTime,
	formatFileSize,
} from "@/viewmodels/forum/thread-detail";
interface PostContentProps {
	post: EnrichedPost;
	isFirst: boolean;
	threadDigest?: number;
}

export function PostContent({ post, isFirst, threadDigest }: PostContentProps) {
	return (
		<div className="flex-1 min-w-0 p-3">
			{/* Top meta bar */}
			<div className="flex items-center gap-2 pb-2 border-b border-border/50 text-xs text-muted-foreground">
				<span>发表于 {formatDateTime(post.createdAt)}</span>

				{/* Digest badge — only first post when digest > 0 */}
				{isFirst && threadDigest !== undefined && threadDigest > 0 && (
					<Badge variant="destructive" className="text-sm px-2 py-0.5 ml-auto md:ml-0">
						精华
					</Badge>
				)}

				<span className="ml-auto font-medium">{floorLabel(post.position, isFirst)}</span>
			</div>

			{/* Post HTML content */}
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
		</div>
	);
}
