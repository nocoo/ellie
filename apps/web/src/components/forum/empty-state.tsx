// components/forum/empty-state.tsx — Lightweight empty-state wrapper

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ForumEmptyStateProps {
	children: ReactNode;
	className?: string;
}

/** Centered muted text block for "no data" states. */
export function ForumEmptyState({ children, className }: ForumEmptyStateProps) {
	return (
		<div className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
			{children}
		</div>
	);
}
