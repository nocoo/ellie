"use client";

// Phase H.3 — extracted from the detail page so the header / meta block
// stays declarative and testable in isolation. The page hands us the loaded
// thread, the flat forum list, and the action callbacks; we own:
//
//   - Forum breadcrumb via `buildForumBreadcrumb` (graceful fallback when
//     parents are missing — see viewmodel for the exact rules).
//   - Status badges (sticky / closed / digest + the H.3 highlight badge).
//   - Type-chip grouping for `typeName / special / recommends /
//     isAuthorFirstThread` so a long flat string of meta no longer eats the
//     header (reviewer feedback).
//   - Author + last-poster links (parity with the list page — never render
//     a bare username when we have an id).
//
// The posts stream / pagination / dialogs stay on the page. This component
// is purely presentational + receives stable callbacks.

import {
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
} from "@/viewmodels/admin/badges";
import { type Forum, buildForumBreadcrumb } from "@/viewmodels/admin/forums";
import { type Thread, digestLabel, stickyLabel } from "@/viewmodels/admin/threads";
import { formatNumber } from "@ellie/shared";
import { Badge, Button } from "@ellie/ui";
import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThreadDetailHeaderProps {
	thread: Thread;
	forums: Forum[];
	onEdit: () => void;
	onDelete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadDetailHeader({ thread, forums, onEdit, onDelete }: ThreadDetailHeaderProps) {
	const breadcrumb = buildForumBreadcrumb(forums, thread.forumId);

	// Group the structural-meta chips so the row isn't a single long string.
	// Each chip is independent — render only when its underlying value
	// implies "set"; the empty-state header should be free of noise.
	const metaChips: { key: string; label: string }[] = [];
	if (thread.typeName) metaChips.push({ key: "type", label: thread.typeName });
	if (thread.special > 0) metaChips.push({ key: "special", label: `special=${thread.special}` });
	if (thread.recommends > 0) {
		metaChips.push({ key: "recommends", label: `推荐 ${formatNumber(thread.recommends)}` });
	}
	if (thread.isAuthorFirstThread) {
		metaChips.push({ key: "firstThread", label: "作者首帖" });
	}

	return (
		<div className="rounded-xl bg-secondary p-1 overflow-x-auto p-4 md:p-6">
			<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2 min-w-0">
					{/* Forum breadcrumb — root-first, current forum is the tail.
					    Last segment is non-linked so it reads as the "you are
					    here" anchor for the thread. */}
					<nav aria-label="版块路径" className="flex flex-wrap items-center gap-1 text-xs">
						{breadcrumb.map((node, idx) => {
							const isLast = idx === breadcrumb.length - 1;
							return (
								<span key={node.id} className="flex items-center gap-1">
									{idx > 0 && <span className="text-muted-foreground">/</span>}
									{isLast ? (
										<span className="text-muted-foreground">{node.name}</span>
									) : (
										<Link
											href={`/admin/forums/${node.id}`}
											className="text-primary hover:underline"
										>
											{node.name}
										</Link>
									)}
								</span>
							);
						})}
					</nav>

					<h1 className="text-xl md:text-2xl font-semibold text-foreground break-words">
						{thread.subject}
					</h1>

					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>
							作者:{" "}
							{thread.authorId > 0 ? (
								<Link
									href={`/admin/users/${thread.authorId}`}
									className="text-primary hover:underline"
								>
									{thread.authorName}
								</Link>
							) : (
								thread.authorName
							)}
						</span>
						<span>·</span>
						<span>{new Date(thread.createdAt * 1000).toLocaleString()}</span>
						<span>·</span>
						<span>{formatNumber(thread.replies)} 回复</span>
						<span>·</span>
						<span>{formatNumber(thread.views)} 浏览</span>
					</div>

					{/* Last-poster line — only render when there IS a last reply
					    (lastPostAt > 0). lastPosterId may still be 0 (worker
					    couldn't join the user row); in that case render the
					    name as plain text rather than a dead link. */}
					{thread.lastPostAt > 0 && thread.lastPoster && (
						<div className="text-sm text-muted-foreground">
							最后回复:{" "}
							{thread.lastPosterId > 0 ? (
								<Link
									href={`/admin/users/${thread.lastPosterId}`}
									className="text-primary hover:underline"
								>
									{thread.lastPoster}
								</Link>
							) : (
								thread.lastPoster
							)}
							<span> · {new Date(thread.lastPostAt * 1000).toLocaleString()}</span>
						</div>
					)}

					{/* Status badges — sticky / closed / digest / highlight.
					    Highlight is new in H.3 to match list-row parity; the
					    encoded RGB bitmask is treated as "set vs unset" via
					    `threadHighlightVariant`. */}
					<div className="flex flex-wrap gap-1.5">
						{thread.sticky > 0 && (
							<Badge variant={threadStickyVariant(thread.sticky)}>
								{stickyLabel(thread.sticky)}
							</Badge>
						)}
						{thread.closed > 0 && (
							<Badge variant={threadClosedVariant(thread.closed)}>已锁定</Badge>
						)}
						{thread.digest > 0 && (
							<Badge variant={threadDigestVariant(thread.digest)}>
								{digestLabel(thread.digest)}
							</Badge>
						)}
						{thread.highlight > 0 && (
							<Badge variant={threadHighlightVariant(thread.highlight)}>高亮</Badge>
						)}
					</div>

					{/* Structural meta chips — typeName / special / recommends /
					    isAuthorFirstThread. Reviewer asked these be GROUPED
					    rather than concatenated into one long string so each
					    one is independently scannable / hideable. */}
					{metaChips.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{metaChips.map((chip) => (
								<Badge key={chip.key} variant="secondary">
									{chip.label}
								</Badge>
							))}
						</div>
					)}
				</div>

				<div className="flex gap-2 shrink-0">
					<Button variant="outline" size="sm" onClick={onEdit}>
						<Pencil className="mr-2 h-4 w-4" />
						编辑
					</Button>
					<Button variant="destructive" size="sm" onClick={onDelete}>
						<Trash2 className="mr-2 h-4 w-4" />
						删除
					</Button>
				</div>
			</div>
		</div>
	);
}
