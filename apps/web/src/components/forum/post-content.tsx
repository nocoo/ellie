// components/forum/post-content.tsx — Discuz classic right-side content area
// Dashed separators, colored icon meta bar, floor superscript, attachments.

import { Badge } from "@/components/ui/badge";
import {
	type EnrichedPost,
	floorLabel,
	formatDateTime,
	formatFileSize,
} from "@/viewmodels/forum/thread-detail";
import type { User } from "@ellie/types";
import { SquarePen } from "lucide-react";

interface PostContentProps {
	post: EnrichedPost;
	isFirst: boolean;
	threadDigest?: number;
	author?: User | null;
}

export function PostContent({ post, isFirst, threadDigest, author }: PostContentProps) {
	return (
		<div className="flex-1 min-w-0 flex flex-col p-3">
			{/* Top meta bar — dashed bottom border */}
			<div className="flex items-center gap-2 pb-2 border-b border-dashed border-[#CCC] text-xs text-[#666]">
				<SquarePen className="h-3.5 w-3.5 text-[#6BB5D8]" />
				<span>发表于 {formatDateTime(post.createdAt)}</span>
				<span className="text-[#CCC]">|</span>
				<span className="text-[#3672A0] hover:underline cursor-pointer">只看该作者</span>

				{/* Digest badge — only first post when digest > 0 */}
				{isFirst && threadDigest !== undefined && threadDigest > 0 && (
					<Badge variant="destructive" className="text-sm px-2 py-0.5">
						精华
					</Badge>
				)}

				{/* Floor — right-aligned with superscript # */}
				<span className="ml-auto font-medium text-[#666]">
					{floorLabel(post.position, isFirst)}
					<sup className="text-[10px]">#</sup>
				</span>
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
									<span className="text-[#999]">📎</span>
									<span className="truncate">{att.filename}</span>
									<span className="text-[#999] shrink-0">{formatFileSize(att.fileSize)}</span>
								</>
							)}
						</div>
					))}
				</div>
			)}

			{/* Spacer pushes signature to bottom when sidebar is taller */}
			<div className="flex-1" />

			{/* Author signature — dashed top border */}
			{author?.signature && (
				<div className="mt-4 pt-2 border-t border-dashed border-[#CCC]">
					<div
						className="text-xs text-[#999] prose prose-sm max-w-none [&>*]:text-[#999] [&>*]:text-xs"
						dangerouslySetInnerHTML={{ __html: author.signature }}
					/>
				</div>
			)}
		</div>
	);
}
