// components/forum/post-content.tsx — Discuz classic right-side content area
// Dashed separators, colored icon meta bar, floor superscript, attachments.
//
// IMPORTANT: `actionBar` is rendered inside this component (not as a sibling)
// because Discuz migrated HTML may contain unclosed tags. When the browser's
// fault-tolerant parser fixes them, it can swallow sibling DOM nodes, causing
// React hydration mismatches. Keeping everything inside one container with
// suppressHydrationWarning prevents that.

import { Badge } from "@/components/ui/badge";
import {
	type EnrichedPost,
	floorLabel,
	formatDateTime,
	formatFileSize,
} from "@/viewmodels/forum/thread-detail";
import type { User } from "@ellie/types";
import { SquarePen } from "lucide-react";
import type { ReactNode } from "react";

interface PostContentProps {
	post: EnrichedPost;
	isFirst: boolean;
	threadDigest?: number;
	author?: User | null;
	/** Rendered after content & signature to avoid hydration issues with unclosed HTML. */
	actionBar?: ReactNode;
}

export function PostContent({ post, isFirst, threadDigest, author, actionBar }: PostContentProps) {
	return (
		<div className="flex-1 min-w-0 flex flex-col" suppressHydrationWarning>
			<div className="p-3 flex flex-col flex-1" suppressHydrationWarning>
				{/* Top meta bar — dashed bottom border */}
				<div className="flex items-center gap-2 pb-2 border-b border-dashed border-border text-xs text-muted-foreground">
					<SquarePen className="h-3.5 w-3.5 text-[#6BB5D8]" />
					<span>发表于 {formatDateTime(post.createdAt)}</span>
					<span className="text-border">|</span>
					<span className="text-forum-link hover:underline cursor-pointer">只看该作者</span>

					{/* Digest badge — only first post when digest > 0 */}
					{isFirst && threadDigest !== undefined && threadDigest > 0 && (
						<Badge variant="destructive" className="text-sm px-2 py-0.5">
							精华
						</Badge>
					)}

					{/* Floor — right-aligned with superscript # */}
					<span className="ml-auto font-medium text-muted-foreground">
						{floorLabel(post.position, isFirst)}
						<sup className="text-[11px]">#</sup>
					</span>
				</div>

				{/* Post HTML content — isolated in <article> so unclosed tags
				   cannot escape into sibling React nodes. */}
				<article
					className="mt-3 prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0"
					suppressHydrationWarning
				>
					<div dangerouslySetInnerHTML={{ __html: post.content }} suppressHydrationWarning />
				</article>

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
										<span className="text-forum-text-muted">📎</span>
										<span className="truncate">{att.filename}</span>
										<span className="text-forum-text-muted shrink-0">{formatFileSize(att.fileSize)}</span>
									</>
								)}
							</div>
						))}
					</div>
				)}

				{/* Spacer pushes signature to bottom when sidebar is taller */}
				<div className="flex-1" />

				{/* Author signature — dashed top border, also isolated */}
				{author?.signature && (
					<div className="mt-4 pt-2 border-t border-dashed border-border">
						<article
							className="text-xs text-forum-text-muted prose prose-sm max-w-none [&>*]:text-forum-text-muted [&>*]:text-xs"
							suppressHydrationWarning
						>
							<div
								dangerouslySetInnerHTML={{ __html: author.signature }}
								suppressHydrationWarning
							/>
						</article>
					</div>
				)}
			</div>

			{/* Action bar rendered INSIDE this component to avoid hydration issues.
			    Unclosed tags in dangerouslySetInnerHTML can cause the browser to
			    absorb sibling DOM nodes during SSR HTML parsing. */}
			{actionBar}
		</div>
	);
}
