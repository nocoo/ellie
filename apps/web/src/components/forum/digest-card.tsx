// components/forum/digest-card.tsx — Digest thread card with enhanced visual
// Displays author avatar, highlight-styled title, badges, and recommends count

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { Thread, ThreadBadge } from "@ellie/types";
import { decodeHighlight } from "@ellie/types";
import { Heart } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

interface DigestCardProps {
	thread: Thread;
	badges: ThreadBadge[];
}

/** Get border color class based on digest level */
function getDigestBorderClass(digest: number): string {
	switch (digest) {
		case 3:
			return "border-l-amber-500"; // Gold for level III
		case 2:
			return "border-l-blue-500"; // Blue for level II
		default:
			return "border-l-success"; // Green for level I
	}
}

/** Build inline style for highlight-styled title */
function getTitleStyle(highlight: number): CSSProperties | undefined {
	const style = decodeHighlight(highlight);
	if (!style) return undefined;

	const css: CSSProperties = {};
	if (style.color) css.color = style.color;
	if (style.bold) css.fontWeight = 600;
	if (style.italic) css.fontStyle = "italic";
	if (style.underline) css.textDecoration = "underline";

	return Object.keys(css).length > 0 ? css : undefined;
}

export function DigestCard({ thread, badges }: DigestCardProps) {
	const borderClass = getDigestBorderClass(thread.digest);
	const titleStyle = getTitleStyle(thread.highlight);

	return (
		<div
			className={`flex items-start gap-3 py-3 px-3 border-l-4 ${borderClass} bg-card/50 rounded-r-md transition-colors hover:bg-accent/50`}
		>
			{/* Author avatar */}
			<Link href={`/users/${thread.authorId}`} className="shrink-0">
				<Avatar size="sm" className="rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.1)]">
					<AvatarImage
						src={getAvatarUrl(thread.authorId, "small")}
						alt={thread.authorName}
						className="rounded-sm"
					/>
					<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
						<img
							src={getStaticImageUrl("tavatar.gif")}
							alt=""
							className="h-full w-full object-cover"
						/>
					</AvatarFallback>
				</Avatar>
			</Link>

			{/* Content */}
			<div className="flex-1 min-w-0">
				{/* Badges row */}
				{badges.length > 0 && (
					<div className="mb-1">
						<ThreadBadgeList badges={badges} />
					</div>
				)}

				{/* Title row */}
				<Link
					href={`/threads/${thread.id}`}
					className="block text-sm text-foreground hover:text-primary transition-colors line-clamp-2"
					style={titleStyle}
				>
					{thread.subject}
				</Link>

				{/* Meta row */}
				<div className="mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<Link href={`/users/${thread.authorId}`} className="hover:text-primary transition-colors">
						{thread.authorName}
					</Link>
					<span>·</span>
					<span>{formatRelativeTime(thread.lastPostAt ?? thread.createdAt)}</span>
					<span>·</span>
					<span>{formatCompactNumber(thread.views)} 览</span>
					<span>·</span>
					<span>{formatCompactNumber(thread.replies)} 回</span>

					{/* Recommends count */}
					{thread.recommends > 0 && (
						<>
							<span>·</span>
							<span className="inline-flex items-center gap-0.5 text-rose-500">
								<Heart className="h-3 w-3 fill-current" />
								{formatCompactNumber(thread.recommends)}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
