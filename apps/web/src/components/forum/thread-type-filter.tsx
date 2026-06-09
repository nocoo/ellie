// components/forum/thread-type-filter.tsx — 主题分类 inline filter pills
// Server component: renders a compact segmented bar above the thread list
// when the forum has thread types enabled + listable AND at least one row.
// Switching pills resets ?page back to 1 (callers don't need to). The "全部"
// pill clears the typeId query entirely.

import type { ForumThreadType } from "@ellie/types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildForumListUrl } from "@/viewmodels/forum/thread-types";

interface ThreadTypeFilterProps {
	forumId: number;
	types: ForumThreadType[];
	/** Currently selected typeId (already normalized by the page). */
	activeTypeId: number | null;
}

export function ThreadTypeFilter({ forumId, types, activeTypeId }: ThreadTypeFilterProps) {
	if (types.length === 0) return null;

	return (
		<div
			className="flex flex-wrap items-center gap-2 py-1"
			data-testid="thread-type-filter"
			aria-label="主题分类筛选"
		>
			<span className="text-xs text-muted-foreground">分类：</span>
			<Pill
				href={buildForumListUrl({ forumId, typeId: null })}
				active={activeTypeId == null}
				label="全部"
			/>
			{types.map((t) => (
				<Pill
					key={t.id}
					href={buildForumListUrl({ forumId, typeId: t.id })}
					active={activeTypeId === t.id}
					label={t.name}
				/>
			))}
		</div>
	);
}

interface PillProps {
	href: string;
	active: boolean;
	label: string;
}

function Pill({ href, active, label }: PillProps) {
	return (
		<Button
			variant={active ? "default" : "outline"}
			size="xs"
			className={cn(
				"h-7 px-3 text-xs",
				active && "bg-primary text-primary-foreground hover:bg-primary/90",
			)}
			{...(active
				? { nativeButton: true, disabled: true, "aria-pressed": true }
				: {
						nativeButton: false,
						"aria-pressed": false,
						render: <Link href={href} prefetch={false} />,
					})}
		>
			{label}
		</Button>
	);
}
