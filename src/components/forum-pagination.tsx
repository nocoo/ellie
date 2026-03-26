// components/forum-pagination.tsx — Keyset pagination controls
// Ref: 04b §共享布局组件 — Pagination
// Uses cursor-based navigation (no page numbers — keyset pagination)

"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";

export interface ForumPaginationProps {
	/** Cursor for previous page, null if on first page */
	prevCursor: string | null;
	/** Cursor for next page, null if on last page */
	nextCursor: string | null;
	/** Total count (optional, for display) */
	total?: number;
	/** Called when user clicks "Previous" */
	onPrev?(cursor: string): void;
	/** Called when user clicks "Next" */
	onNext?(cursor: string): void;
	/** Called when user clicks "Reset to first page" */
	onReset?(): void;
	className?: string;
}

export function ForumPagination({
	prevCursor,
	nextCursor,
	total,
	onPrev,
	onNext,
	onReset,
	className,
}: ForumPaginationProps) {
	const hasPrev = prevCursor !== null;
	const hasNext = nextCursor !== null;

	if (!hasPrev && !hasNext) return null;

	return (
		<nav
			aria-label="Pagination"
			className={cn("flex items-center justify-between gap-4", className)}
		>
			<div className="flex items-center gap-2">
				{hasPrev && onReset && (
					<Button variant="ghost" size="sm" onClick={onReset}>
						First
					</Button>
				)}
				<Button
					variant="outline"
					size="sm"
					disabled={!hasPrev}
					onClick={() => hasPrev && onPrev?.(prevCursor)}
				>
					<ChevronLeft className="mr-1 h-4 w-4" />
					Previous
				</Button>
			</div>

			{total !== undefined && <span className="text-sm text-muted-foreground">{total} total</span>}

			<Button
				variant="outline"
				size="sm"
				disabled={!hasNext}
				onClick={() => hasNext && onNext?.(nextCursor)}
			>
				Next
				<ChevronRight className="ml-1 h-4 w-4" />
			</Button>
		</nav>
	);
}
