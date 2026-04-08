"use client";

// components/forum/forum-card.tsx — Forum card with two layout variants
// "wide" = full-width row (学习与学术区 style), "grid" = compact cell in 2-col grid (社团与爱好区 style)

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatCount } from "@/viewmodels/forum/forum-list";
import { formatDateTime } from "@/viewmodels/shared/formatting";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";
import { SafeHtml } from "./safe-html";
import { UserPopover } from "./user-popover";

interface ForumCardProps {
	forum: ForumTreeNode;
	layout?: "wide" | "grid";
}

/** Forum icon — Discuz original: forum_new.gif when active, forum.gif when idle */
function ForumIcon({ hasActivity = false }: { hasActivity?: boolean }) {
	const src = getStaticImageUrl(hasActivity ? "forum_new.gif" : "forum.gif");
	return <img src={src} alt="" className="h-7 w-auto shrink-0" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Wide layout — one forum per row
// Desktop: 3-column (info | stats | last post)
// Mobile: 2-row compact (name + description on row 1, stats inline on row 2)
// ---------------------------------------------------------------------------

function ForumCardWide({ forum }: { forum: ForumTreeNode }) {
	const mods = forum.moderatorList ?? [];

	return (
		<div className="relative transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
			{/* Desktop layout */}
			<div className="hidden sm:flex items-start gap-3 px-4 py-3.5">
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
							{mods.map((mod, i) => (
								<span key={mod.id}>
									{i > 0 && <span className="text-xs text-muted-foreground">, </span>}
									<UserPopover userId={mod.id}>
										<span className="text-xs text-forum-link hover:underline cursor-pointer">
											{mod.name}
										</span>
									</UserPopover>
								</span>
							))}
						</div>
					)}
				</div>

				{/* Middle: stats — "帖数 / 回帖" */}
				<div className="flex flex-col items-end text-xs text-muted-foreground shrink-0 tabular-nums min-w-[80px]">
					<span>
						<span className="text-foreground font-medium">{formatCount(forum.threads)}</span>
						{" / "}
						{formatCount(forum.posts)}
					</span>
				</div>

				{/* Right: last post info (md+ only) */}
				{forum.lastPostAt > 0 && (
					<div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground shrink-0 min-w-[200px]">
						{/* Last poster avatar */}
						{forum.lastPosterId > 0 && (
							<Link href={`/users/${forum.lastPosterId}`} className="shrink-0">
								<Avatar size="sm" className="rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.1)]">
									<AvatarImage
										src={getAvatarUrl(forum.lastPosterId, "small")}
										alt={forum.lastPoster}
										className="rounded-sm"
									/>
									<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
										<img
											src={getStaticImageUrl("tavatar.gif")}
											alt=""
											className="h-full w-full object-cover"
										/>
									</AvatarFallback>
								</Avatar>
							</Link>
						)}
						<div className="flex flex-col items-end min-w-0">
							<Link
								href={`/threads/${forum.lastThreadId}`}
								className="relative z-10 text-forum-link hover:underline truncate max-w-[180px]"
							>
								{forum.lastThreadSubject || "最新主题"}
							</Link>
							<span className="mt-0.5 leading-5">
								{formatDateTime(forum.lastPostAt)}{" "}
								{forum.lastPosterId > 0 ? (
									<UserPopover userId={forum.lastPosterId}>
										<span className="text-forum-link hover:underline cursor-pointer">
											{forum.lastPoster}
										</span>
									</UserPopover>
								) : (
									<span className="text-forum-link">{forum.lastPoster}</span>
								)}
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Mobile layout: compact 2-row display */}
			<div className="sm:hidden px-3 py-2.5">
				{/* Row 1: icon + name + today count */}
				<div className="flex items-center gap-2">
					<ForumIcon hasActivity={forum.todayThreads > 0} />
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-bold text-foreground hover:text-destructive transition-colors"
					>
						{forum.name}
					</Link>
					{forum.todayThreads > 0 && (
						<span className="text-xs text-forum-accent font-medium">
							+{formatCount(forum.todayThreads)}
						</span>
					)}
				</div>
				{/* Row 2: stats + last poster */}
				<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
					<span className="tabular-nums">
						{formatCount(forum.threads)} 帖 / {formatCount(forum.posts)} 回
					</span>
					{forum.lastPostAt > 0 && (
						<>
							<span>·</span>
							<span className="truncate">
								{forum.lastPoster} {formatDateTime(forum.lastPostAt)}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Grid layout — compact cell for 2-col grid
// Desktop: icon + name + stats + last post preview
// Mobile: same but more compact
// ---------------------------------------------------------------------------

function ForumCardGrid({ forum }: { forum: ForumTreeNode }) {
	const mods = forum.moderatorList ?? [];

	return (
		<div className="relative flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-inset">
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
							+{formatCount(forum.todayThreads)}
						</span>
					)}
				</div>
				<div className="mt-0.5 text-xs text-muted-foreground tabular-nums leading-5">
					{formatCount(forum.threads)} 帖 / {formatCount(forum.posts)} 回
				</div>

				{/* Moderators */}
				{mods.length > 0 && (
					<div className="mt-0.5 text-xs text-muted-foreground leading-5">
						版主:{" "}
						{mods.map((mod, i) => (
							<span key={mod.id}>
								{i > 0 && ", "}
								<UserPopover userId={mod.id}>
									<span className="text-forum-link hover:underline cursor-pointer">{mod.name}</span>
								</UserPopover>
							</span>
						))}
					</div>
				)}

				{/* Last post preview */}
				{forum.lastPostAt > 0 && (
					<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
						{forum.lastPosterId > 0 && (
							<Link href={`/users/${forum.lastPosterId}`} className="shrink-0">
								<Avatar size="sm" className="rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.1)]">
									<AvatarImage
										src={getAvatarUrl(forum.lastPosterId, "small")}
										alt={forum.lastPoster}
										className="rounded-sm"
									/>
									<AvatarFallback className="text-xs rounded-sm bg-muted p-0 overflow-hidden">
										<img
											src={getStaticImageUrl("tavatar.gif")}
											alt=""
											className="h-full w-full object-cover"
										/>
									</AvatarFallback>
								</Avatar>
							</Link>
						)}
						<Link
							href={`/threads/${forum.lastThreadId}`}
							className="relative z-10 text-forum-link hover:underline truncate"
						>
							{forum.lastThreadSubject || "最新主题"}
						</Link>{" "}
						<span className="shrink-0">{forum.lastPoster}</span>
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
