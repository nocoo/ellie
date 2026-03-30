// components/forum/forum-card.tsx — Forum card with two layout variants
// "wide" = full-width row (学习与学术区 style), "grid" = compact cell in 2-col grid (社团与爱好区 style)

import { formatCount } from "@/viewmodels/forum/forum-list";
import type { ForumTreeNode } from "@ellie/types";
import { BookOpen, Briefcase, GraduationCap, MessageSquareText, Users } from "lucide-react";
import Link from "next/link";
import { SafeHtml } from "./safe-html";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

/** Pick a default lucide icon based on forum icon field or fallback */
function ForumIcon({ icon }: { icon: string }) {
	// If a custom emoji icon is set, use it
	if (icon && /\p{Emoji}/u.test(icon)) {
		return <span className="text-lg leading-none">{icon}</span>;
	}
	// Default: use a lucide icon based on rough heuristics
	const iconClass = "h-8 w-8 text-muted-foreground/40";
	switch (icon) {
		case "book":
			return <BookOpen className={iconClass} />;
		case "work":
			return <Briefcase className={iconClass} />;
		case "edu":
			return <GraduationCap className={iconClass} />;
		case "community":
			return <Users className={iconClass} />;
		default:
			return <MessageSquareText className={iconClass} />;
	}
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
		<div className="relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent/30">
			{/* Icon */}
			<div className="mt-0.5 shrink-0">
				<ForumIcon icon={forum.icon} />
			</div>

			{/* Left: name + description + moderators/sub-forums */}
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-bold text-primary hover:underline transition-colors"
					>
						{forum.name}
					</Link>
					{forum.children.length > 0 && (
						<span className="text-xs text-orange-500 font-medium">
							({formatCount(forum.threads)})
						</span>
					)}
				</div>
				{forum.description && (
					<SafeHtml
						html={forum.description}
						className="mt-0.5 block text-xs text-muted-foreground leading-relaxed line-clamp-1"
					/>
				)}
				{forum.children.length > 0 && (
					<div className="relative z-10 mt-0.5 flex items-center gap-1 flex-wrap">
						<span className="text-xs text-muted-foreground">版主:</span>
						{forum.children.map((sub, i) => (
							<span key={sub.id}>
								{i > 0 && <span className="text-xs text-muted-foreground">, </span>}
								<Link href={`/forums/${sub.id}`} className="text-xs text-primary hover:underline">
									{sub.name}
								</Link>
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
						className="relative z-10 text-primary hover:underline truncate max-w-[200px]"
					>
						最新帖子 ...
					</Link>
					<span className="mt-0.5">
						{formatDate(forum.lastPostAt)} {forum.lastPoster}
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
	return (
		<div className="relative flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-accent/30">
			{/* Icon */}
			<div className="mt-0.5 shrink-0">
				<ForumIcon icon={forum.icon} />
			</div>

			<div className="min-w-0 flex-1">
				{/* Name + count */}
				<div className="flex items-baseline gap-1.5 flex-wrap">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-bold text-primary hover:underline transition-colors"
					>
						{forum.name}
					</Link>
					{forum.children.length > 0 && (
						<span className="text-xs text-orange-500 font-medium">({forum.children.length})</span>
					)}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
					主题: {formatCount(forum.threads)}, 帖数: {formatCount(forum.posts)}
				</div>

				{/* Last post preview */}
				{forum.lastPostAt > 0 && (
					<div className="mt-1 text-xs text-muted-foreground truncate">
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
