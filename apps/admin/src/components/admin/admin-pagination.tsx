"use client";

import { Button } from "@ellie/ui";
import { formatNumber } from "@ellie/shared";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationInfo {
	page: number;
	pages: number;
	total: number;
	limit: number;
}

export interface AdminPaginationProps {
	pagination: PaginationInfo;
	onPageChange: (page: number) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Compute the visible page range for pagination controls.
 * Returns [start, end] (1-indexed, inclusive).
 */
export function computePageRange(current: number, total: number, maxVisible = 5): [number, number] {
	if (total <= maxVisible) return [1, total];
	const half = Math.floor(maxVisible / 2);
	let start = current - half;
	let end = current + half;
	if (start < 1) {
		start = 1;
		end = maxVisible;
	}
	if (end > total) {
		end = total;
		start = Math.max(1, total - maxVisible + 1);
	}
	return [start, end];
}

/**
 * Compute the item range being displayed.
 * Returns "start–end" string.
 */
export function computeItemRange(page: number, limit: number, total: number): string {
	const start = (page - 1) * limit + 1;
	const end = Math.min(page * limit, total);
	return `${start}–${end}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminPagination({ pagination, onPageChange }: AdminPaginationProps) {
	const { page, pages, total, limit } = pagination;

	if (pages <= 1) return null;

	const [rangeStart, rangeEnd] = computePageRange(page, pages);
	const pageNumbers: number[] = [];
	for (let i = rangeStart; i <= rangeEnd; i++) {
		pageNumbers.push(i);
	}

	return (
		<div className="flex items-center justify-between px-2 py-3">
			<p className="text-sm text-muted-foreground">
				{computeItemRange(page, limit, total)} / {formatNumber(total)}
			</p>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					disabled={page <= 1}
					onClick={() => onPageChange(1)}
					aria-label="首页"
				>
					<ChevronsLeft className="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
					aria-label="上一页"
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				{pageNumbers.map((p) => (
					<Button
						key={p}
						variant={p === page ? "default" : "ghost"}
						size="icon"
						className="h-8 w-8"
						onClick={() => onPageChange(p)}
						aria-label={`第 ${p} 页`}
						aria-current={p === page ? "page" : undefined}
					>
						{p}
					</Button>
				))}
				<Button
					variant="ghost"
					size="icon"
					disabled={page >= pages}
					onClick={() => onPageChange(page + 1)}
					aria-label="下一页"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					disabled={page >= pages}
					onClick={() => onPageChange(pages)}
					aria-label="末页"
				>
					<ChevronsRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}
