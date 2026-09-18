"use client";

// Phase H.3 — extracted from the detail page so the header / meta block
// stays declarative and testable in isolation. The page hands us the loaded
// thread, the flat forum list, and the action callbacks; we own:
//
//   - Forum breadcrumb via `buildForumBreadcrumb` (graceful fallback when
//     parents are missing — see viewmodel for the exact rules).
//   - Status badges (sticky / closed / digest + the H.3 highlight badge).
//   - Type-chip grouping for `typeName / special / recommends` so a long flat string of meta no longer eats the
//     header (reviewer feedback).
//   - Author + last-poster links (parity with the list page — never render
//     a bare username when we have an id).
//
// The posts stream / pagination / dialogs stay on the page. This component
// is purely presentational + receives stable callbacks.

import { formatNumber } from "@ellie/shared";
import { contentToText } from "@ellie/shared/content";
import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Eye, Files, MessageSquare, Pencil, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import {
	threadClosedVariant,
	threadDigestVariant,
	threadHighlightVariant,
	threadStickyVariant,
} from "@/viewmodels/admin/badges";
import { buildForumBreadcrumb, type Forum } from "@/viewmodels/admin/forums";
import { digestLabel, stickyLabel, type Thread } from "@/viewmodels/admin/threads";

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

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-start gap-2">
						<Files aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-basalt-primary" />
						<span className="wrap-anywhere">{contentToText(thread.subject)}</span>
					</span>
				}
				description={`主题 #${thread.id}`}
				actions={
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
				}
			/>
			<LayerCard padding="sm">
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
					<div className="space-y-2 min-w-0">
						{/* Forum breadcrumb — root-first, current forum is the tail.
					    Last segment is non-linked so it reads as the "you are
					    here" anchor for the thread. Non-last segments link to
					    the threads list filtered by that forum
					    (`/admin/threads?forumId=<id>`) because admin doesn't
					    have per-forum detail routes — H.3.1 reviewer feedback.
					 */}
						<nav aria-label="版块路径" className="flex flex-wrap items-center gap-1 text-xs">
							{breadcrumb.map((node, idx) => {
								const isLast = idx === breadcrumb.length - 1;
								return (
									<span key={node.id} className="flex items-center gap-1">
										{idx > 0 && <span className="text-basalt-muted-foreground">/</span>}
										{isLast ? (
											<span className="text-basalt-muted-foreground">{node.name}</span>
										) : (
											<Link
												href={`/admin/threads?forumId=${node.id}`}
												className="break-all text-basalt-primary hover:underline"
											>
												{node.name}
											</Link>
										)}
									</span>
								);
							})}
						</nav>

						<div className="flex flex-wrap items-center gap-2 text-xs text-basalt-muted-foreground">
							<span>
								作者:{" "}
								{thread.authorId > 0 ? (
									<Link
										href={`/admin/users/${thread.authorId}`}
										className="break-all text-basalt-primary hover:underline"
									>
										{thread.authorName}
									</Link>
								) : (
									thread.authorName
								)}
							</span>
							<span>·</span>
							<span>{new Date(thread.createdAt * 1000).toLocaleString()}</span>
						</div>

						{/* Last-poster line — only render when there IS a last reply
					    (lastPostAt > 0). lastPosterId may still be 0 (worker
					    couldn't join the user row); in that case render the
					    name as plain text rather than a dead link. */}
						{thread.lastPostAt > 0 && thread.lastPoster && (
							<div className="text-xs text-basalt-muted-foreground">
								最后回复:{" "}
								{thread.lastPosterId > 0 ? (
									<Link
										href={`/admin/users/${thread.lastPosterId}`}
										className="break-all text-basalt-primary hover:underline"
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

						{/* Structural meta chips — typeName / special / recommends. Reviewer asked these be GROUPED
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
					<dl className="grid grid-cols-3 gap-3 text-xs" aria-label="主题互动数据">
						{[
							{ label: "回复", value: thread.replies, icon: MessageSquare },
							{ label: "浏览", value: thread.views, icon: Eye },
							{ label: "推荐", value: thread.recommends, icon: ThumbsUp },
						].map(({ label, value, icon: Icon }) => (
							<div key={label}>
								<dt className="flex items-center gap-1.5 text-basalt-muted-foreground">
									<Icon aria-hidden="true" className="h-3.5 w-3.5" />
									{label}
								</dt>
								<dd className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(value)}</dd>
							</div>
						))}
					</dl>
				</div>
			</LayerCard>
		</div>
	);
}
