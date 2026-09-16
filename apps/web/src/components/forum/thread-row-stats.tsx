// components/forum/thread-row-stats.tsx — Shared stats display for thread rows
// Used by thread-item.tsx and digest-card.tsx

import { Eye, Heart, MessageSquare } from "lucide-react";
import { formatCompactNumber } from "@/viewmodels/shared/formatting";

interface ThreadRowStatsProps {
	replies: number;
	views: number;
	recommends: number;
	variant: "desktop" | "mobile";
}

/**
 * Thread row stats — replies/views count with optional recommends.
 *
 * - "desktop": full column cell (80px fixed-width block with stacked lines)
 * - "mobile": inline content meant to sit inside `<span className="ml-auto tabular-nums">`
 */
export function ThreadRowStats({ replies, views, recommends, variant }: ThreadRowStatsProps) {
	if (variant === "desktop") {
		return (
			<div
				className="flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums"
				data-testid="thread-row-stats-desktop"
			>
				<span className="text-xs text-foreground font-medium">
					{formatCompactNumber(replies)} / {formatCompactNumber(views)}
				</span>
				{recommends > 0 ? (
					<span className="inline-flex items-center gap-0.5 text-xs text-destructive">
						<Heart className="h-3 w-3 fill-current" aria-hidden="true" />
						<span className="sr-only">推荐 </span>
						{formatCompactNumber(recommends)}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">回/览</span>
				)}
			</div>
		);
	}

	return (
		<span
			data-testid="thread-row-stats-mobile"
			className="inline-flex items-center gap-2 whitespace-nowrap"
		>
			<span className="inline-flex items-center gap-1" title={`${replies} 条回复`}>
				<MessageSquare className="size-3" aria-hidden="true" />
				<span className="sr-only">回复 </span>
				{formatCompactNumber(replies)}
			</span>
			<span className="inline-flex items-center gap-1" title={`${views} 次查看`}>
				<Eye className="size-3" aria-hidden="true" />
				<span className="sr-only">浏览 </span>
				{formatCompactNumber(views)}
			</span>
			{recommends > 0 && (
				<span className="inline-flex items-center gap-0.5 ml-1.5 text-destructive">
					<Heart className="h-3 w-3 fill-current" aria-hidden="true" />
					<span className="sr-only">推荐 </span>
					{formatCompactNumber(recommends)}
				</span>
			)}
		</span>
	);
}
