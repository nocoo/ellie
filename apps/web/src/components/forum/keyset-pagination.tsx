// components/forum/keyset-pagination.tsx — Shared keyset pagination controls
// Ref: 04f §4 — extracted from 5 duplicated PageLink implementations

import { Button } from "@nocoo/basalt/components/button";
import Link from "next/link";
import { formatNumber } from "@/viewmodels/shared/formatting";

interface KeysetPaginationProps {
	total: number | null;
	totalLabel?: string;
	prevHref: string | null;
	nextHref: string | null;
	className?: string;
}

export function KeysetPagination({
	total,
	totalLabel = "条",
	prevHref,
	nextHref,
	className,
}: KeysetPaginationProps) {
	return (
		<div className={className ?? "flex flex-wrap items-center justify-between gap-3 py-2"}>
			{total !== null && (
				<span className="text-xs text-basalt-muted-foreground">
					共 {formatNumber(total)} {totalLabel}
				</span>
			)}
			<div className="ml-auto flex items-center gap-2">
				{prevHref ? (
					<Button asChild variant="outline" size="sm">
						<Link href={prevHref} prefetch={false}>
							← 上一页
						</Link>
					</Button>
				) : (
					<Button variant="outline" size="sm" disabled>
						← 上一页
					</Button>
				)}
				{nextHref ? (
					<Button asChild variant="outline" size="sm">
						<Link href={nextHref} prefetch={false}>
							下一页 →
						</Link>
					</Button>
				) : (
					<Button variant="outline" size="sm" disabled>
						下一页 →
					</Button>
				)}
			</div>
		</div>
	);
}
