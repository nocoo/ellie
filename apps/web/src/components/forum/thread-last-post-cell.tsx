// components/forum/thread-last-post-cell.tsx — Shared "last post" column cell
// Used by thread-item.tsx and digest-card.tsx (desktop layout column 4)

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";
import { UserPopover } from "./user-popover";

interface ThreadLastPostCellProps {
	lastPosterId: number;
	lastPoster: string;
	lastPostAt: number;
	className?: string;
}

/** Desktop column 4: last poster name (with popover if valid) + relative time. */
export function ThreadLastPostCell({
	lastPosterId,
	lastPoster,
	lastPostAt,
	className,
}: ThreadLastPostCellProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center w-[120px] shrink-0 py-2 text-center",
				className,
			)}
		>
			{lastPosterId > 0 ? (
				<UserPopover userId={lastPosterId}>
					<span className="text-xs text-foreground font-medium truncate max-w-full hover:text-primary transition-colors cursor-pointer">
						{lastPoster || "-"}
					</span>
				</UserPopover>
			) : (
				<span className="text-xs text-muted-foreground truncate max-w-full">
					{lastPoster || "-"}
				</span>
			)}
			<span className="text-xs text-muted-foreground">
				{lastPostAt ? formatRelativeTime(lastPostAt) : "-"}
			</span>
		</div>
	);
}
