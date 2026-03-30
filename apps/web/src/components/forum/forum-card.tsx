// components/forum/forum-card.tsx — Dense forum row within group card
// Ref: 04f §5 — single-line: icon + name/subs + stats + last post

import { formatCount } from "@/viewmodels/forum/forum-list";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";
import { SafeHtml } from "./safe-html";

interface ForumCardProps {
	forum: ForumTreeNode;
}

function timeAgo(timestamp: number): string {
	if (timestamp === 0) return "";
	const now = Date.now() / 1000;
	const diff = now - timestamp;
	if (diff < 60) return "刚刚";
	if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
	if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
	return `${Math.floor(diff / 2592000)}个月前`;
}

export function ForumCard({ forum }: ForumCardProps) {
	return (
		<div className="relative flex items-center gap-3 py-2.5 transition-colors hover:bg-accent/50">
			{forum.icon && <span className="text-base shrink-0">{forum.icon}</span>}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 flex-wrap">
					<Link
						href={`/forums/${forum.id}`}
						className="text-sm font-medium text-foreground hover:text-primary transition-colors after:absolute after:inset-0"
					>
						{forum.name}
					</Link>
					{forum.description && (
						<SafeHtml html={forum.description} className="text-xs text-muted-foreground truncate" />
					)}
					{forum.children.length > 0 && (
						<span className="relative z-10 hidden sm:inline-flex gap-1.5">
							{forum.children.map((sub) => (
								<Link
									key={sub.id}
									href={`/forums/${sub.id}`}
									className="text-xs text-primary hover:underline"
								>
									{sub.name}
								</Link>
							))}
						</span>
					)}
				</div>
			</div>
			<div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
				<span>{formatCount(forum.threads)} 帖</span>
				<span>{formatCount(forum.posts)} 回</span>
			</div>
			{forum.lastPostAt > 0 && (
				<div className="hidden md:block text-xs text-muted-foreground shrink-0 text-right min-w-[120px]">
					{forum.lastPoster} · {timeAgo(forum.lastPostAt)}
				</div>
			)}
		</div>
	);
}
