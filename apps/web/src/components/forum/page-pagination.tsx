// components/forum/page-pagination.tsx — Discuz classic page-number pagination
// Server component with Link-based page buttons + client JumpToPage island

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { JumpToPage } from "./jump-to-page";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PagePaginationProps {
	page: number;
	pages: number;
	total: number;
	basePath: string;
	className?: string;
}

export type PageItem = number | "ellipsis";

// ---------------------------------------------------------------------------
// Pure helper — exported for testing
// ---------------------------------------------------------------------------

/**
 * Generate page number items with ellipsis gaps.
 *
 * Strategy: always show first `headCount` pages, last `tailCount` pages,
 * and a window of `windowSize` around the current page. Gaps are filled
 * with a single "ellipsis" sentinel.
 */
export function generatePageNumbers(
	current: number,
	total: number,
	headCount = 5,
	tailCount = 3,
	windowSize = 2,
): PageItem[] {
	if (total <= 0) return [];
	if (total <= headCount + tailCount + 1) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}

	const pages = new Set<number>();

	// Head: 1..headCount
	for (let i = 1; i <= Math.min(headCount, total); i++) pages.add(i);

	// Window around current
	for (let i = Math.max(1, current - windowSize); i <= Math.min(total, current + windowSize); i++)
		pages.add(i);

	// Tail: last tailCount pages
	for (let i = Math.max(1, total - tailCount + 1); i <= total; i++) pages.add(i);

	// Sort and insert ellipsis where there are gaps
	const sorted = [...pages].sort((a, b) => a - b);
	const result: PageItem[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const curr = sorted[i] as number;
		const prev = sorted[i - 1] as number | undefined;
		if (prev !== undefined && curr - prev > 1) {
			result.push("ellipsis");
		}
		result.push(curr);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PagePagination({ page, pages, total, basePath, className }: PagePaginationProps) {
	if (pages <= 1) return null;

	const items = generatePageNumbers(page, pages);

	function href(p: number): string {
		return p === 1 ? basePath : `${basePath}?page=${p}`;
	}

	return (
		<div className={className ?? "flex flex-wrap items-center justify-between gap-2 py-2"}>
			<div className="flex flex-wrap items-center gap-1">
				{/* Prev */}
				{page > 1 ? (
					<Button
						variant="outline"
						size="icon-xs"
						nativeButton={false}
						render={<Link href={href(page - 1)} />}
					>
						<ChevronLeft />
					</Button>
				) : (
					<Button variant="outline" size="icon-xs" disabled>
						<ChevronLeft />
					</Button>
				)}

				{/* Page numbers */}
				{items.map((item, i) =>
					item === "ellipsis" ? (
						<span
							key={`ellipsis-${items[i - 1]}`}
							className="px-1 text-xs text-muted-foreground select-none"
						>
							...
						</span>
					) : (
						<Button
							key={item}
							variant={item === page ? "default" : "outline"}
							size="xs"
							nativeButton={item !== page}
							{...(item !== page ? { render: <Link href={href(item)} /> } : { disabled: true })}
						>
							{item}
						</Button>
					),
				)}

				{/* Next */}
				{page < pages ? (
					<Button
						variant="outline"
						size="icon-xs"
						nativeButton={false}
						render={<Link href={href(page + 1)} />}
					>
						<ChevronRight />
					</Button>
				) : (
					<Button variant="outline" size="icon-xs" disabled>
						<ChevronRight />
					</Button>
				)}
			</div>

			<div className="flex items-center gap-3">
				<span className="text-xs text-muted-foreground">共 {total.toLocaleString()} 条</span>
				<JumpToPage basePath={basePath} pages={pages} />
			</div>
		</div>
	);
}
