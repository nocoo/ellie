// components/forum/empty-state.tsx — Lightweight empty-state wrapper

import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ForumEmptyStateProps {
	children: ReactNode;
	className?: string;
}

/** Centered muted text block for "no data" states. */
export function ForumEmptyState({ children, className }: ForumEmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground",
				className,
			)}
		>
			<span
				className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted"
				aria-hidden="true"
			>
				<Inbox className="h-5 w-5" />
			</span>
			{children}
		</div>
	);
}
