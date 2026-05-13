// components/forum/user-profile-list-row.tsx
// Shared forum-list-style row for the three user profile tabs (主题/回复/精华).
//
// Layout — desktop (sm+): [Icon] [Title (link, truncate)] [Forum chip (link)] [N回 N览] [time]
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
			className="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors truncate max-w-[8rem]"
		>
			{forumName}
		</Link>
	) : null;

	const stats = (
		<span className="shrink-0 tabular-nums text-xs text-muted-foreground">
			{formatCompactNumber(thread.replies)}回 · {formatCompactNumber(thread.views)}览
		</span>
	);

	return (
		<div className="border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50">
			{/* Desktop layout: single row */}
			<div className="hidden sm:flex items-center gap-2 px-2 py-2">
				{/* Icon */}
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={iconSrc} alt="" className="shrink-0 opacity-70" />
				{/* Title + badges + digest icon */}
				<div className="min-w-0 flex-1 flex items-center gap-1.5">
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
				{/* Forum chip */}
				{forumChip}
				{/* Stats */}
				{stats}
				{/* Time */}
				<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
					{formatRelativeTime(time)}
				</span>
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
					{forumChip && stats && <span className="shrink-0">·</span>}
					{stats}
				</div>
			</div>
		</div>
	);
}
