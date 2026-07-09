"use client";

// thread-columns — shared admin table column preset for `Thread` rows.
//
// Consumed by:
//   - /admin/threads/page.tsx (variant: "full") — main thread management.
//   - /admin/recent/page.tsx ThreadsTab (variant: "compact") — the
//     incremental view. Omits forum, status Badge stack, lastPost;
//     matches recent's pre-extraction column count.
//
// See user-columns.tsx for the extraction contract; actions column is not
// emitted here (each caller splices its own).

import { formatDate, formatNumber } from "@ellie/shared";
import { Badge } from "@ellie/ui";
import Link from "next/link";
import type { ColumnDef } from "@/components/admin/admin-data-table";
import {
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
} from "@/viewmodels/admin/badges";
import { digestLabel, stickyLabel, type Thread } from "@/viewmodels/admin/threads";

export type ThreadColumnVariant = "full" | "compact";

export interface BuildThreadColumnsOpts {
	variant: ThreadColumnVariant;
	/**
	 * Full-variant-only. Given a forum id, return its display name. When
	 * omitted, the forum column falls back to `#<id>`. Kept as a function
	 * (not a Forum[] array) so callers control caching of their forum
	 * lookup — see /admin/threads/page.tsx's `useMemo(() => (id) => ...)`.
	 */
	forumNameById?: (id: number) => string;
}

/**
 * Build the shared `ColumnDef<Thread>[]` for admin thread tables.
 *
 * Full variant column keys:
 *   subject, forum, author, replies, views, status, createdAt, lastPost
 * Compact variant column keys:
 *   subject, author, createdAt, replies, views
 */
export function buildThreadColumns(opts: BuildThreadColumnsOpts): ColumnDef<Thread>[] {
	const { variant, forumNameById } = opts;

	const subjectCell: ColumnDef<Thread> = {
		key: "subject",
		header: "标题",
		cell: (row) => (
			<div className="flex flex-col gap-0.5">
				<Link
					href={`/admin/threads/${row.id}`}
					className="font-medium text-foreground hover:underline"
				>
					{row.subject}
				</Link>
				{row.typeName && (
					<span className="text-xs text-muted-foreground">类型：{row.typeName}</span>
				)}
			</div>
		),
	};

	const forumCell: ColumnDef<Thread> = {
		key: "forum",
		header: "版块",
		cell: (row) => (
			<span className="text-sm text-muted-foreground">
				{forumNameById ? forumNameById(row.forumId) : `#${row.forumId}`}
			</span>
		),
	};

	const authorCell: ColumnDef<Thread> = {
		key: "author",
		header: "作者",
		cell: (row) =>
			row.authorId > 0 ? (
				<Link href={`/admin/users/${row.authorId}`} className="text-primary hover:underline">
					{row.authorName}
				</Link>
			) : (
				row.authorName
			),
	};

	const repliesCell: ColumnDef<Thread> = {
		key: "replies",
		header: "回复",
		// `?? 0` guards against payloads where the worker omitted counters —
		// /admin/recent (which uses the same /api/admin/threads endpoint
		// with a different time window) can land rows whose replies/views
		// are transiently undefined; the pre-extraction inline version in
		// recent already had this fallback. Kept defensive here so any
		// caller (main threads page or recent) survives sparse rows.
		cell: (row) => formatNumber(row.replies ?? 0),
		className: "text-right",
	};

	const viewsCell: ColumnDef<Thread> = {
		key: "views",
		header: "浏览",
		cell: (row) => formatNumber(row.views ?? 0),
		className: "text-right",
	};

	const statusCell: ColumnDef<Thread> = {
		key: "status",
		header: "状态",
		cell: (row) => (
			<div className="flex flex-wrap gap-1">
				{row.sticky > 0 && (
					<Badge variant={threadStickyVariant(row.sticky)}>{stickyLabel(row.sticky)}</Badge>
				)}
				{row.closed > 0 && <Badge variant={threadClosedVariant(row.closed)}>已锁定</Badge>}
				{row.digest > 0 && (
					<Badge variant={threadDigestVariant(row.digest)}>{digestLabel(row.digest)}</Badge>
				)}
				{row.highlight > 0 && <Badge variant={threadHighlightVariant(row.highlight)}>高亮</Badge>}
			</div>
		),
	};

	const createdAtCell: ColumnDef<Thread> = {
		key: "createdAt",
		header: "创建于",
		cell: (row) => (
			<span className="text-sm text-muted-foreground">{formatDate(row.createdAt) || "—"}</span>
		),
	};

	const lastPostCell: ColumnDef<Thread> = {
		key: "lastPost",
		header: "最后回复",
		cell: (row) => {
			if (!row.lastPostAt) return <span className="text-muted-foreground">—</span>;
			const date = formatDate(row.lastPostAt);
			return (
				<div className="flex flex-col gap-0.5 text-sm">
					<span>{date}</span>
					{row.lastPoster && (
						<span className="text-xs text-muted-foreground">
							{row.lastPosterId > 0 ? (
								<Link href={`/admin/users/${row.lastPosterId}`} className="hover:underline">
									{row.lastPoster}
								</Link>
							) : (
								row.lastPoster
							)}
						</span>
					)}
				</div>
			);
		},
	};

	if (variant === "full") {
		return [
			subjectCell,
			forumCell,
			authorCell,
			repliesCell,
			viewsCell,
			statusCell,
			createdAtCell,
			lastPostCell,
		];
	}
	// compact
	return [subjectCell, authorCell, createdAtCell, repliesCell, viewsCell];
}
