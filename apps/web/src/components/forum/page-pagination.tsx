// components/forum/page-pagination.tsx — Discuz classic page-number pagination
// Server component with Link-based page buttons + client JumpToPage island

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/viewmodels/shared/formatting";
import { generatePageNumbers } from "@/viewmodels/shared/pagination";
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
	/** Unit label appended after the total count, e.g. "个主题" → "共 1,234 个主题" */
	totalLabel?: string;
	/** Show "第 X / Y 页 · 共 N totalLabel" summary. Default: false. */
	showPageInfo?: boolean;
	className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PagePagination({
	page,
	pages,
	total,
	basePath,
	totalLabel = "条",
	showPageInfo = false,
	className,
}: PagePaginationProps) {
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
						render={<Link href={href(page - 1)} prefetch={false} />}
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
							className={item === page ? "bg-primary text-primary-foreground" : undefined}
							{...(item === page
								? { nativeButton: true, disabled: true }
								: { nativeButton: false, render: <Link href={href(item)} prefetch={false} /> })}
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
						render={<Link href={href(page + 1)} prefetch={false} />}
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
				<span className="text-xs text-muted-foreground">
					{showPageInfo && (
						<>
							第 {page} / {pages} 页 ·{" "}
						</>
					)}
					共 {formatNumber(total ?? 0)} {totalLabel}
				</span>
				<JumpToPage basePath={basePath} pages={pages} />
			</div>
		</div>
	);
}
