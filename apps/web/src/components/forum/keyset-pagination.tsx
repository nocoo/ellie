// components/forum/keyset-pagination.tsx — Shared keyset pagination controls
// Ref: 04f §4 — extracted from 5 duplicated PageLink implementations

import { Button } from "@/components/ui/button";
import Link from "next/link";

interface KeysetPaginationProps {
	total: number;
	totalLabel?: string;
	prevHref: string | null;
	nextHref: string | null;
}

export function KeysetPagination({
	total,
	totalLabel = "条",
	prevHref,
	nextHref,
}: KeysetPaginationProps) {
	return (
		<div className="flex items-center justify-between py-2">
			<span className="text-xs text-muted-foreground">
				共 {total.toLocaleString()} {totalLabel}
			</span>
			<div className="flex items-center gap-2">
				{prevHref ? (
					<Button variant="outline" size="xs" render={<Link href={prevHref} />}>
						← 上一页
					</Button>
				) : (
					<Button variant="outline" size="xs" disabled>
						← 上一页
					</Button>
				)}
				{nextHref ? (
					<Button variant="outline" size="xs" render={<Link href={nextHref} />}>
						下一页 →
					</Button>
				) : (
					<Button variant="outline" size="xs" disabled>
						下一页 →
					</Button>
				)}
			</div>
		</div>
	);
}
