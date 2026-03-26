// components/forum/thread-list.tsx — Thread list container
// Ref: 04d §ThreadList — container with sort controls

import type { ThreadListItem, ThreadSort } from "@/viewmodels/forum/thread-list";
import { ThreadItem } from "./thread-item";

export interface ThreadListProps {
	items: ThreadListItem[];
	sort: ThreadSort;
	onSortChange: (sort: ThreadSort) => void;
	digestOnly: boolean;
	onDigestToggle: () => void;
}

export const SORT_OPTIONS: { value: ThreadSort; label: string }[] = [
	{ value: "latest", label: "Latest Reply" },
	{ value: "newest", label: "Newest" },
	{ value: "hot", label: "Hot" },
];

export function ThreadList({
	items,
	sort,
	onSortChange,
	digestOnly,
	onDigestToggle,
}: ThreadListProps) {
	return (
		<div>
			{/* Sort controls */}
			<div className="mb-3 flex flex-wrap items-center gap-2">
				{SORT_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => onSortChange(option.value)}
						className={`rounded-md px-3 py-1 text-sm transition-colors ${
							sort === option.value
								? "bg-primary text-primary-foreground"
								: "bg-secondary text-muted-foreground hover:text-foreground"
						}`}
					>
						{option.label}
					</button>
				))}
				<button
					type="button"
					onClick={onDigestToggle}
					className={`rounded-md px-3 py-1 text-sm transition-colors ${
						digestOnly
							? "bg-primary text-primary-foreground"
							: "bg-secondary text-muted-foreground hover:text-foreground"
					}`}
				>
					Digest Only
				</button>
			</div>

			{/* Thread items */}
			<div className="space-y-2">
				{items.map((item) => (
					<ThreadItem
						key={item.thread.id}
						thread={item.thread}
						badges={item.badges}
						highlightStyle={item.highlightStyle}
					/>
				))}
				{items.length === 0 && (
					<div className="rounded-[10px] bg-secondary p-6 text-center text-muted-foreground">
						No threads found.
					</div>
				)}
			</div>
		</div>
	);
}
