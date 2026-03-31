// components/forum/forum-card.tsx — Forum card with two layout variants
// "wide" = full-width row (学习与学术区 style), "grid" = compact cell in 2-col grid (社团与爱好区 style)

import { getStaticImageUrl } from "@/lib/cdn";
import { formatCount } from "@/viewmodels/forum/forum-list";
import { formatDateTime } from "@/viewmodels/shared/formatting";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";
import { SafeHtml } from "./safe-html";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

/** Parse comma-separated moderator names into array */
function parseModerators(moderators: string): string[] {
	if (!moderators) return [];
	return moderators
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Forum icon — Discuz original: forum_new.gif when active, forum.gif when idle */
function ForumIcon({ hasActivity = false }: { hasActivity?: boolean }) {
	const src = getStaticImageUrl(hasActivity ? "forum_new.gif" : "forum.gif");
	return (
		// biome-ignore lint/nursery/noImgElement: intentional pixel-art GIF from CDN
		<img src={src} alt="" className="h-7 w-auto shrink-0" aria-hidden="true" />
	);
}

// ---------------------------------------------------------------------------
// Wide layout — one forum per row, 3-column: info | stats | last post
// ---------------------------------------------------------------------------

function ForumCardWide({ forum }: { forum: ForumTreeNode }) {
	const mods = parseModerators(forum.moderators);

	return (
		<div className="relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent">
			{/* Icon */}
			<div className="mt-0.5 shrink-0">
				<ForumIcon hasActivity={forum.todayThreads > 0} />
			</div>

			{/* Left: name + description + sub-forums + moderators */}
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
					>
						{forum.name}
					</Link>
					{forum.todayThreads > 0 && (
						<span className="text-xs text-forum-accent font-medium">
							({formatCount(forum.todayThreads)})
						</span>
					)}
				</div>
				{forum.description && (
					<SafeHtml
						html={forum.description}
						className="mt-0.5 block text-xs text-muted-foreground leading-5 line-clamp-1"
					/>
				)}

				{/* Sub-forums */}
				{forum.children.length > 0 && (
					<div className="relative z-10 mt-0.5 flex items-baseline gap-1 flex-wrap leading-5">
						<span className="text-xs text-muted-foreground">子版面:</span>
						{forum.children.map((sub, i) => (
							<span key={sub.id}>
								{i > 0 && <span className="text-xs text-muted-foreground">, </span>}
								<Link
									href={`/forums/${sub.id}`}
									className="text-xs text-forum-link hover:underline"
								>
									{sub.name}
								</Link>
							</span>
						))}
					</div>
				)}

				{/* Moderators */}
				{mods.length > 0 && (
					<div className="relative z-10 mt-0.5 flex items-baseline gap-1 flex-wrap leading-5">
						<span className="text-xs text-muted-foreground">版主:</span>
						{mods.map((name, i) => (
							<span key={name}>
								{i > 0 && <span className="text-xs text-muted-foreground">, </span>}
								<span className="text-xs text-forum-link hover:underline cursor-pointer">
									{name}
								</span>
							</span>
						))}
					</div>
				)}
			</div>

			{/* Middle: stats — "帖数 / 回帖" */}
			<div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground shrink-0 tabular-nums min-w-[80px]">
				<span>
					<span className="text-foreground font-medium">{formatCount(forum.threads)}</span>
					{" / "}
					{formatCount(forum.posts)}
				</span>
			</div>

			{/* Right: last post info */}
			{forum.lastPostAt > 0 && (
				<div className="hidden md:flex flex-col items-end text-xs text-muted-foreground shrink-0 min-w-[200px]">
					<Link
						href={`/threads/${forum.lastThreadId}`}
						className="relative z-10 text-forum-link hover:underline truncate max-w-[200px]"
					>
						{forum.lastThreadSubject || "最新帖子"}
					</Link>
					<span className="mt-0.5 leading-5">
						{formatDateTime(forum.lastPostAt)}{" "}
						<span className="text-forum-link hover:underline cursor-pointer">
							{forum.lastPoster}
						</span>
					</span>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Grid layout — compact cell for 2-col grid
// ---------------------------------------------------------------------------

function ForumCardGrid({ forum }: { forum: ForumTreeNode }) {
	const mods = parseModerators(forum.moderators);

	return (
		<div className="relative flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-accent">
			{/* Icon */}
			<div className="mt-0.5 shrink-0">
				<ForumIcon hasActivity={forum.todayThreads > 0} />
			</div>

			<div className="min-w-0 flex-1">
				{/* Name + count */}
				<div className="flex items-baseline gap-1.5 flex-wrap">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
					>
						{forum.name}
					</Link>
					{forum.todayThreads > 0 && (
						<span className="text-xs text-forum-accent font-medium">
							({formatCount(forum.todayThreads)})
						</span>
					)}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground tabular-nums leading-5">
					主题: {formatCount(forum.threads)}, 帖数: {formatCount(forum.posts)}
				</div>

				{/* Moderators */}
				{mods.length > 0 && (
					<div className="mt-0.5 text-xs text-muted-foreground leading-5">
						版主:{" "}
						{mods.map((name, i) => (
							<span key={name}>
								{i > 0 && ", "}
								<span className="text-forum-link hover:underline cursor-pointer">{name}</span>
							</span>
						))}
					</div>
				)}

				{/* Last post preview */}
				{forum.lastPostAt > 0 && (
					<div className="mt-1 text-xs text-muted-foreground truncate leading-5">
						<Link
							href={`/threads/${forum.lastThreadId}`}
							className="relative z-10 text-forum-link hover:underline"
						>
							{forum.lastThreadSubject || "最新帖子"}
						</Link>{" "}
						{formatDateTime(forum.lastPostAt)}{" "}
						<span className="text-forum-link hover:underline cursor-pointer">
							{forum.lastPoster}
						</span>
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
