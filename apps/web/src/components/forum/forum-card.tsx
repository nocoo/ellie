// components/forum/forum-card.tsx — Forum card with stats and last post info
// Ref: 04d §ForumCard — icon + name + stats + last post + subs

import { formatCount } from "@/viewmodels/forum/forum-list";
import type { ForumTreeNode } from "@ellie/types";
import Link from "next/link";

interface ForumCardProps {
	forum: ForumTreeNode;
}

function timeAgo(timestamp: number): string {
	if (timestamp === 0) return "";
	const now = Date.now() / 1000;
	const diff = now - timestamp;
	if (diff < 60) return "刚刚";
	if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
	if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
	if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
	return `${Math.floor(diff / 2592000)} 个月前`;
}

export function ForumCard({ forum }: ForumCardProps) {
	return (
		<Link
			href={`/forums/${forum.id}`}
			className="block rounded-[10px] bg-secondary p-4 transition-colors hover:bg-accent"
		>
			<div className="flex items-start gap-3">
				{forum.icon && <span className="mt-0.5 text-lg shrink-0">{forum.icon}</span>}
				<div className="min-w-0 flex-1">
					<h3 className="text-sm font-semibold text-foreground">{forum.name}</h3>
					{forum.description && (
						<p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{forum.description}</p>
					)}
					<div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
						<span>帖子 {formatCount(forum.threads)}</span>
						<span>回帖 {formatCount(forum.posts)}</span>
					</div>
					{forum.lastPostAt > 0 && (
						<p className="mt-1 text-xs text-muted-foreground">
							最新: {forum.lastPoster} · {timeAgo(forum.lastPostAt)}
						</p>
					)}
					{forum.children.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-2">
							{forum.children.map((sub) => (
								<Link
									key={sub.id}
									href={`/forums/${sub.id}`}
									className="text-xs text-primary hover:underline"
									onClick={(e) => e.stopPropagation()}
								>
									{sub.name}
								</Link>
							))}
						</div>
					)}
				</div>
			</div>
		</Link>
	);
}
