// components/forum/thread-type-filter.tsx — 主题分类 inline filter pills
// Server component: renders a compact segmented bar above the thread list
// when the forum has thread types enabled + listable AND at least one row.
// Switching pills resets ?page back to 1 (callers don't need to). The "全部"
// pill clears the typeId query entirely.

import type { ForumThreadType } from "@ellie/types";
import { Button } from "@nocoo/basalt/components/button";
import Link from "next/link";
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
		// biome-ignore lint/a11y/useSemanticElements: not a form control; <fieldset>/<legend> carries form/reset semantics we don't want here. This is a navigational group of links.
		<div
			className="flex flex-wrap items-center gap-2 rounded-xl border border-basalt-border bg-basalt-card p-3"
			data-testid="thread-type-filter"
			role="group"
			aria-label="主题分类筛选"
		>
			<span className="text-xs text-basalt-muted-foreground">分类：</span>
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
	const className = cn(
		"h-7 px-3 text-xs",
		active && "bg-basalt-primary text-basalt-primary-foreground hover:bg-basalt-primary/90",
	);
	return active ? (
		<Button size="sm" className={className} disabled aria-pressed>
			{label}
		</Button>
	) : (
		<Button asChild variant="outline" size="sm" className={className} aria-pressed={false}>
			<Link href={href} prefetch={false}>
				{label}
			</Link>
		</Button>
	);
}
