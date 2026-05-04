// components/forum/thread-row-stats.tsx — Shared stats display for thread rows
// Used by thread-item.tsx and digest-card.tsx

import { formatCompactNumber } from "@/viewmodels/shared/formatting";
import { Heart } from "lucide-react";

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
			<div className="flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums">
				<span className="text-xs text-foreground font-medium">
					{formatCompactNumber(replies)} / {formatCompactNumber(views)}
				</span>
				{recommends > 0 ? (
					<span className="inline-flex items-center gap-0.5 text-xs text-rose-500">
						<Heart className="h-3 w-3 fill-current" />
						{formatCompactNumber(recommends)}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">回/览</span>
				)}
			</div>
		);
	}

	// mobile — fragment content for inside an existing wrapper span
	return (
		<>
			{formatCompactNumber(replies)} 回 / {formatCompactNumber(views)} 览
			{recommends > 0 && (
				<span className="inline-flex items-center gap-0.5 ml-1.5 text-rose-500">
					<Heart className="h-3 w-3 fill-current" />
					{formatCompactNumber(recommends)}
				</span>
			)}
		</>
	);
}
