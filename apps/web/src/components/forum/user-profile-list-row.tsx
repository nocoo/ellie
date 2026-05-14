// components/forum/user-profile-list-row.tsx
// Shared forum-list-style row for the three user profile tabs (主题/回复/精华).
//
// Layout — desktop (sm+): grid with 5 explicit columns so every tab aligns
//   exactly: [Icon] [主题] [板块] [回复 · 查看] [时间]
//   The grid template is exported via `PROFILE_ROW_GRID_COLS` so the optional
//   `UserProfileListHeader` (rendered once per tab) reuses the same template
//   and stays in column alignment regardless of which tab is active.
// Layout — mobile (<sm):
//   Row1: [Icon] [Title (link, truncate)] [time]
//   Row2:        [Forum chip] · N回 · N览
//
// Title/Forum/stats all derive from the same minimal `ThreadSource` shape so
// the row works for both full `Thread` (主题/精华 Tab) and `PostThreadSummary`
// (回复 Tab, which carries only the joined columns we actually display).

import { ThreadBadgeList } from "@/components/forum/thread-badge";
import {
	filterIconRedundantBadges,
	getDigestIconSrc,
	getThreadIconSrc,
	highlightStyle,
} from "@/viewmodels/forum/thread-list";
import { formatCompactNumber, formatRelativeTime } from "@/viewmodels/shared/formatting";
import type { ThreadBadgeSource } from "@ellie/types";
import { decodeHighlight, getThreadBadges } from "@ellie/types";
import Link from "next/link";

/**
 * Shared desktop grid template for the profile-list row + header. Centralizing
 * the column widths here is what guarantees the three tabs render exactly the
 * same column geometry — change in one place, all tabs follow.
 *
 * Columns: Icon(28px) | 主题(flex) | 板块(8rem) | 回复·查看(7rem) | 时间(5.5rem)
 */
export const PROFILE_ROW_GRID_COLS = "28px minmax(0,1fr) 8rem 7rem 5.5rem";

/**
 * Minimal structural source for a profile-list row.
 *
 * Both `Thread` and `PostThreadSummary` satisfy this shape — the helper
 * functions (`getThreadIconSrc`, `getThreadBadges`, `decodeHighlight`)
 * already operate on the same minimal fields.
 */
export interface ProfileRowThreadSource extends ThreadBadgeSource {
	id: number;
	forumId: number;
	subject: string;
	replies: number;
	views: number;
	createdAt: number;
	lastPostAt: number;
	highlight: number;
}

interface UserProfileListRowProps {
	thread: ProfileRowThreadSource;
	/** forumId → name, supplied once by the parent so each row is a pure lookup. */
	forumsById: Readonly<Record<number, string>>;
	/** Whether to use `createdAt` (default) or `lastPostAt ?? createdAt` for the displayed time. */
	timeSource?: "created" | "lastPost";
	/**
	 * Explicit override for the displayed time (Unix seconds). When provided,
	 * this wins over `timeSource` — e.g. the 回复 tab passes the user's reply
	 * timestamp here rather than mutating the underlying thread's `createdAt`.
	 */
	displayTime?: number;
}

export function UserProfileListRow({
	thread,
	forumsById,
	timeSource = "created",
	displayTime,
}: UserProfileListRowProps) {
	const badges = filterIconRedundantBadges(getThreadBadges(thread));
	const hl = decodeHighlight(thread.highlight);
	const iconSrc = getThreadIconSrc(thread);
	const digestSrc = getDigestIconSrc(thread.digest);
	const time =
		displayTime ??
		(timeSource === "lastPost" ? (thread.lastPostAt ?? thread.createdAt) : thread.createdAt);
	const forumName = forumsById[thread.forumId];

	const titleLink = (
		<Link
			href={`/threads/${thread.id}`}
			prefetch={false}
			className="min-w-0 truncate text-sm text-foreground hover:text-primary transition-colors"
			style={highlightStyle(hl)}
		>
			{thread.subject}
		</Link>
	);

	const forumChip = forumName ? (
		<Link
			href={`/forums/${thread.forumId}`}
			prefetch={false}
			className="text-xs text-muted-foreground hover:text-primary transition-colors truncate"
		>
			{forumName}
		</Link>
	) : null;

	const statsText = `${formatCompactNumber(thread.replies)}回 · ${formatCompactNumber(thread.views)}览`;

	return (
		<div
			className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50"
			data-testid="user-profile-list-row"
		>
			{/* Desktop layout: explicit 5-column grid so all three tabs align. */}
			<div
				className="hidden sm:grid items-center gap-2 px-2 py-2"
				style={{ gridTemplateColumns: PROFILE_ROW_GRID_COLS }}
			>
				{/* Col 1: Icon */}
				<div className="flex justify-center" data-testid="row-col-icon">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={iconSrc} alt="" className="shrink-0 opacity-70" />
				</div>
				{/* Col 2: 主题 (title + badges + digest icon) */}
				<div className="min-w-0 flex items-center gap-1.5" data-testid="row-col-title">
					{badges.length > 0 && (
						<span className="inline-flex items-center gap-1 shrink-0">
							<ThreadBadgeList badges={badges} />
						</span>
					)}
					{titleLink}
					{digestSrc && (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={digestSrc} alt="digest" className="shrink-0" />
					)}
				</div>
				{/* Col 3: 板块 */}
				<div className="min-w-0 text-xs" data-testid="row-col-forum">
					{forumChip ?? <span className="text-muted-foreground/60">—</span>}
				</div>
				{/* Col 4: 回复 · 查看 */}
				<div
					className="tabular-nums text-xs text-muted-foreground text-right"
					data-testid="row-col-stats"
				>
					{statsText}
				</div>
				{/* Col 5: 时间 */}
				<div
					className="tabular-nums text-xs text-muted-foreground text-right"
					data-testid="row-col-time"
				>
					{formatRelativeTime(time)}
				</div>
			</div>

			{/* Mobile layout: two-row compact */}
			<div className="sm:hidden px-3 py-2">
				{/* Row 1: Icon + title + time */}
				<div className="flex items-start gap-1.5">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={iconSrc} alt="" className="shrink-0 opacity-70 mt-0.5" />
					<div className="min-w-0 flex-1">
						{badges.length > 0 && (
							<div className="flex items-center gap-1.5">
								<ThreadBadgeList badges={badges} />
							</div>
						)}
						<div className="flex items-center gap-1.5">
							{titleLink}
							{digestSrc && (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={digestSrc} alt="digest" className="shrink-0" />
							)}
						</div>
					</div>
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
						{formatRelativeTime(time)}
					</span>
				</div>
				{/* Row 2: forum chip · stats */}
				<div className="mt-1 ml-6 flex items-center gap-1.5 text-xs text-muted-foreground">
					{forumChip}
					{forumChip && <span className="shrink-0">·</span>}
					<span className="tabular-nums shrink-0">{statsText}</span>
				</div>
			</div>
		</div>
	);
}

/**
 * Desktop-only column header for the profile-list, reusing the same grid
 * template so the labels line up over the data columns. Hidden on mobile —
 * the mobile layout is two-row compact and doesn't benefit from a header.
 *
 * Rendered once per tab, above the list of rows. Three tabs share this
 * header so column widths never drift independently.
 */
export function UserProfileListHeader() {
	return (
		<div
			className="hidden sm:grid items-center gap-2 px-2 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/30"
			style={{ gridTemplateColumns: PROFILE_ROW_GRID_COLS }}
			data-testid="user-profile-list-header"
		>
			<div />
			<div>主题</div>
			<div>板块</div>
			<div className="text-right">回复 · 查看</div>
			<div className="text-right">时间</div>
		</div>
	);
}
