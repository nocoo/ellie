// components/forum/post-content.tsx — Discuz classic right-side content area
// Dashed separators, colored icon meta bar, floor superscript, attachments.
//
// IMPORTANT: `actionBar` is rendered inside this component (not as a sibling)
// because Discuz migrated HTML may contain unclosed tags. When the browser's
// fault-tolerant parser fixes them, it can swallow sibling DOM nodes, causing
// React hydration mismatches. Keeping everything inside one container with
// suppressHydrationWarning prevents that.

import { Badge } from "@/components/ui/badge";
import { getAttachmentThumbUrl, getAttachmentUrl, getStaticImageUrl } from "@/lib/cdn";
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
	/** Post comments section, rendered after action bar */
	comments?: ReactNode;
}

export function PostContent({
	post,
	isFirst,
	threadDigest,
	author,
	actionBar,
	comments,
}: PostContentProps) {
	return (
		<div className="flex-1 min-w-0 flex flex-col" suppressHydrationWarning>
			<div className="p-3 flex flex-col flex-1" suppressHydrationWarning>
				{/* Top meta bar — dashed bottom border */}
				<div className="flex items-center gap-2 pb-2 border-b border-dashed border-border text-xs text-muted-foreground">
					<SquarePen className="h-3.5 w-3.5 text-primary" />
					<span>发表于 {formatDateTime(post.createdAt)}</span>

					{/* Digest badge — only first post when digest > 0 */}
					{isFirst && threadDigest !== undefined && threadDigest > 0 && (
						<Badge variant="destructive" className="text-sm px-2 py-0.5">
							精华
						</Badge>
					)}

					{/* Floor — right-aligned with superscript # */}
					<span className="ml-auto font-medium text-muted-foreground">
						{floorLabel(post.position, isFirst)}
						<sup className="text-2xs">#</sup>
					</span>
				</div>

				{/* Post HTML content — isolated in <article> so unclosed tags
				   cannot escape into sibling React nodes. */}
				<article
					className="mt-3 prose prose-sm max-w-none text-foreground whitespace-pre-line [&>*:first-child]:mt-0"
					suppressHydrationWarning
				>
					<div dangerouslySetInnerHTML={{ __html: post.content }} suppressHydrationWarning />
				</article>

				{/* Attachments */}
				{post.attachments.length > 0 && (
					<div className="mt-3 space-y-1.5">
						{post.attachments.map((att) => {
							const attachmentUrl = getAttachmentUrl(att.filePath);
							const thumbUrl = att.hasThumb ? getAttachmentThumbUrl(att.filePath) : attachmentUrl;
							return (
								<div
									key={att.id}
									className="flex items-center gap-2 rounded-lg bg-background p-2 text-xs"
								>
									{att.isImage ? (
										<a href={attachmentUrl} target="_blank" rel="noopener noreferrer">
											<img src={thumbUrl} alt={att.filename} className="max-h-20 rounded" />
										</a>
									) : (
										<>
											<span className="text-forum-text-muted">📎</span>
											<span className="truncate">{att.filename}</span>
											<span className="text-forum-text-muted shrink-0">
												{formatFileSize(att.fileSize)}
											</span>
										</>
									)}
								</div>
							);
						})}
					</div>
				)}

				{/* Spacer pushes signature to bottom when sidebar is taller */}
				<div className="flex-1" />

				{/* Author signature — sigline.gif separator, left-aligned */}
				{author?.signature && (
					<div className="mt-4">
						<div className="flex justify-start">
							<img
								src={getStaticImageUrl("sigline.gif")}
								alt=""
								className="h-auto w-auto max-w-full"
								aria-hidden="true"
							/>
						</div>
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

			{/* Post comments section - above action bar */}
			{comments}

			{/* Action bar rendered INSIDE this component to avoid hydration issues.
			    Unclosed tags in dangerouslySetInnerHTML can cause the browser to
			    absorb sibling DOM nodes during SSR HTML parsing. */}
			{actionBar}
		</div>
	);
}
