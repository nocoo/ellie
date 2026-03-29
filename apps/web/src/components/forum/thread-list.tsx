// components/forum/thread-list.tsx — Thread list container with sort/filter controls
// Ref: 04d §版块帖子列表 — sort tabs + digest filter + pagination

import { Button } from "@/components/ui/button";
import type { ThreadDisplayItem, ThreadSort } from "@/viewmodels/forum/thread-list";
import { sortLabel } from "@/viewmodels/forum/thread-list";
import { ThreadItem } from "./thread-item";

const SORT_OPTIONS: ThreadSort[] = ["latest", "newest", "hot"];

interface ThreadListProps {
	items: ThreadDisplayItem[];
	sort: ThreadSort;
	digestOnly: boolean;
	onSortChange: (sort: ThreadSort) => void;
	onDigestToggle: () => void;
	nextCursor: string | null;
	prevCursor: string | null;
	onNextPage: () => void;
	onPrevPage: () => void;
	total: number;
}

export function ThreadList({
	items,
	sort,
	digestOnly,
	onSortChange,
	onDigestToggle,
	nextCursor,
	prevCursor,
	onNextPage,
	onPrevPage,
	total,
}: ThreadListProps) {
	return (
		<div className="space-y-4">
			{/* Sort + Filter bar */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					{SORT_OPTIONS.map((option) => (
						<Button
							key={option}
							variant={sort === option ? "default" : "ghost"}
							size="xs"
							onClick={() => onSortChange(option)}
						>
							{sortLabel(option)}
						</Button>
					))}
				</div>
				<Button variant={digestOnly ? "default" : "ghost"} size="xs" onClick={onDigestToggle}>
					只看精华
				</Button>
			</div>

			{/* Thread items */}
			{items.length === 0 ? (
				<div className="rounded-lg bg-card p-8 text-center text-sm text-muted-foreground">
					暂无帖子
				</div>
			) : (
				<div className="space-y-2">
					{items.map((item) => (
						<ThreadItem key={item.thread.id} item={item} />
					))}
				</div>
			)}

			{/* Keyset pagination */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground">共 {total} 条</span>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="xs" disabled={!prevCursor} onClick={onPrevPage}>
						← 上一页
					</Button>
					<Button variant="outline" size="xs" disabled={!nextCursor} onClick={onNextPage}>
						下一页 →
					</Button>
				</div>
			</div>
		</div>
	);
}
