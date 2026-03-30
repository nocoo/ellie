// components/forum/forum-card.tsx — Forum card with two layout variants
// "wide" = full-width row (like 学习与学术区), "grid" = compact cell in 2-col grid (like 社团与爱好区)

import { formatCount } from "@/viewmodels/forum/forum-list";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";
import { SafeHtml } from "./safe-html";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

/** Format unix timestamp to YYYY-M-D HH:mm */
function formatDate(timestamp: number): string {
	if (timestamp === 0) return "";
	const d = new Date(timestamp * 1000);
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Wide layout — one forum per row, 3-column: info | stats | last post
// ---------------------------------------------------------------------------

function ForumCardWide({ forum }: { forum: ForumTreeNode }) {
	return (
		<div className="relative flex items-start gap-3 py-3 transition-colors hover:bg-accent/50">
			{/* Icon */}
			{forum.icon && <span className="mt-0.5 text-base shrink-0">{forum.icon}</span>}

			{/* Left: name + description + moderators */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-medium text-primary hover:underline transition-colors after:absolute after:inset-0"
					>
						{forum.name}
					</Link>
					{forum.children.length > 0 && (
						<span className="text-xs text-muted-foreground">({forum.children.length})</span>
					)}
				</div>
				{forum.description && (
					<SafeHtml
						html={forum.description}
						className="mt-0.5 block text-xs text-muted-foreground line-clamp-1"
					/>
				)}
				{forum.children.length > 0 && (
					<div className="relative z-10 mt-0.5 flex items-center gap-1 flex-wrap">
						<span className="text-xs text-muted-foreground">版主:</span>
						{forum.children.map((sub) => (
							<Link
								key={sub.id}
								href={`/forums/${sub.id}`}
								className="text-xs text-primary hover:underline"
							>
								{sub.name}
							</Link>
						))}
					</div>
				)}
			</div>

			{/* Middle: stats */}
			<div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground shrink-0 tabular-nums text-right min-w-[80px]">
				<span>{formatCount(forum.threads)}</span>
				<span>/</span>
				<span>{formatCount(forum.posts)}</span>
			</div>

			{/* Right: last post info */}
			{forum.lastPostAt > 0 && (
				<div className="hidden md:block text-xs text-muted-foreground shrink-0 text-right min-w-[180px]">
					<div className="text-foreground/80 truncate max-w-[180px]">
						<Link
							href={`/threads/${forum.lastThreadId}`}
							className="relative z-10 hover:text-primary transition-colors"
						>
							最新帖子 ...
						</Link>
					</div>
					<div className="mt-0.5">
						{formatDate(forum.lastPostAt)} {forum.lastPoster}
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Grid layout — compact cell for 2-col grid
// ---------------------------------------------------------------------------

function ForumCardGrid({ forum }: { forum: ForumTreeNode }) {
	return (
		<div className="relative flex items-start gap-2.5 p-3 transition-colors hover:bg-accent/50">
			{/* Icon */}
			{forum.icon && <span className="mt-0.5 text-lg shrink-0">{forum.icon}</span>}

			<div className="min-w-0 flex-1">
				{/* Name + stats */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-medium text-primary hover:underline transition-colors after:absolute after:inset-0"
					>
						{forum.name}
					</Link>
					{forum.children.length > 0 && (
						<span className="text-xs text-muted-foreground">({forum.children.length})</span>
					)}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
					主题: {formatCount(forum.threads)}, 帖数: {formatCount(forum.posts)}
				</div>

				{/* Last post preview */}
				{forum.lastPostAt > 0 && (
					<div className="mt-1 text-xs text-muted-foreground">
						<Link
							href={`/threads/${forum.lastThreadId}`}
							className="relative z-10 text-primary hover:underline"
						>
							最新帖子 ...
						</Link>{" "}
						{formatDate(forum.lastPostAt)} {forum.lastPoster}
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ForumCard({ forum, layout = "wide" }: ForumCardProps) {
	return layout === "grid" ? <ForumCardGrid forum={forum} /> : <ForumCardWide forum={forum} />;
}
