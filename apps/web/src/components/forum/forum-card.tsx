// components/forum/forum-card.tsx — Forum card in the forum list
// Ref: 04d §ForumCard — icon + name + stats + latest post + sub-forums

import { cn } from "@/lib/utils";
import type { ForumTreeNode } from "@ellie/types";
import { MessageSquare, Users } from "lucide-react";
import Link from "next/link";

export interface ForumCardProps {
	forum: ForumTreeNode;
	className?: string;
}

/**
 * Format a large number for display (e.g., 12345 → "12.3K").
 * Pure function, exported for testing.
 */
export function formatCount(n: number): string {
	if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

/**
 * Format a Unix timestamp as relative time (e.g., "2h ago").
 * Pure function, exported for testing.
 */
export function formatRelativeTime(timestamp: number): string {
	if (timestamp === 0) return "";
	const now = Date.now() / 1000;
	const diff = now - timestamp;

	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
	return `${Math.floor(diff / 2592000)}mo ago`;
}

export function ForumCard({ forum, className }: ForumCardProps) {
	return (
		<div className={cn("rounded-[10px] bg-secondary p-4", className)}>
			<div className="flex items-start gap-3">
				{/* Icon */}
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
					{forum.icon || "💬"}
				</div>

				{/* Content */}
				<div className="min-w-0 flex-1">
					<Link
						href={`/forums/${forum.id}`}
						className="font-medium hover:text-primary transition-colors"
					>
						{forum.name}
					</Link>
					{forum.description && (
						<p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">{forum.description}</p>
					)}

					{/* Stats */}
					<div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
						<span className="flex items-center gap-1">
							<MessageSquare className="h-3.5 w-3.5" />
							{formatCount(forum.threads)} threads
						</span>
						<span className="flex items-center gap-1">
							<Users className="h-3.5 w-3.5" />
							{formatCount(forum.posts)} posts
						</span>
						{forum.lastPoster && (
							<span>
								Latest by {forum.lastPoster} {formatRelativeTime(forum.lastPostAt)}
							</span>
						)}
					</div>

					{/* Sub-forums */}
					{forum.children.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{forum.children.map((sub) => (
								<Link
									key={sub.id}
									href={`/forums/${sub.id}`}
									className="rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									{sub.name}
								</Link>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
