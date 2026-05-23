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
			<div
				className="flex flex-col items-center justify-center w-[80px] shrink-0 py-2 text-center tabular-nums"
				data-testid="thread-row-stats-desktop"
			>
				<span className="text-xs text-foreground font-medium">
					{formatCompactNumber(replies)} / {formatCompactNumber(views)}
				</span>
				{recommends > 0 ? (
					<span className="inline-flex items-center gap-0.5 text-xs text-destructive">
						<Heart className="h-3 w-3 fill-current" />
						{formatCompactNumber(recommends)}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">回/览</span>
				)}
			</div>
		);
	}

	// mobile — fragment content for inside an existing wrapper span. Wrapped
	// in a `<span data-testid="thread-row-stats-mobile">` so callers that
	// removed this variant on mobile (per reviewer freeze msg=8b90cb85) can
	// pin the absence via testid rather than text-content regex.
	return (
		<span data-testid="thread-row-stats-mobile">
			{formatCompactNumber(replies)} 回 / {formatCompactNumber(views)} 览
			{recommends > 0 && (
				<span className="inline-flex items-center gap-0.5 ml-1.5 text-destructive">
					<Heart className="h-3 w-3 fill-current" />
					{formatCompactNumber(recommends)}
				</span>
			)}
		</span>
	);
}
