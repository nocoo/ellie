"use client";

import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@ellie/ui";
import type { EnrichedPost } from "@/viewmodels/admin/thread-detail";
import { roleLabel } from "@/viewmodels/admin/users";
import { formatNumber } from "@ellie/shared";
import { MoreHorizontal, Pencil, Shield, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostFloorProps {
	post: EnrichedPost;
	onEdit: (post: EnrichedPost) => void;
	onDelete: (post: EnrichedPost) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number): string {
	return new Date(ts * 1000).toLocaleString();
}

function roleBadgeVariant(role: number): "default" | "secondary" | "destructive" | "outline" {
	switch (role) {
		case 1:
			return "destructive"; // Admin
		case 2:
			return "default"; // SuperMod
		case 3:
			return "secondary"; // Mod
		default:
			return "outline"; // Member
	}
}

function statusIndicator(status: number): string | null {
	switch (status) {
		case -1:
			return "已封禁";
		case -2:
			return "已归档";
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostFloor({ post, onEdit, onDelete }: PostFloorProps) {
	const { author } = post;

	return (
		<div className="rounded-[var(--radius-card,14px)] bg-secondary overflow-hidden">
			{/* Floor header */}
			<div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span className="font-mono font-medium text-foreground">#{post.position}</span>
					{post.isFirst && <Badge variant="default">楼主</Badge>}
					<span>{formatDate(post.createdAt)}</span>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" className="h-7 w-7">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(post)}>
							<Pencil className="mr-2 h-4 w-4" />
							编辑
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => onDelete(post)}
							className="text-destructive"
							disabled={post.isFirst}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							{post.isFirst ? "无法删除楼主帖" : "删除"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="flex flex-col md:flex-row">
				{/* Author sidebar */}
				<div className="flex md:flex-col items-center md:items-center gap-3 md:gap-2 border-b md:border-b-0 md:border-r p-4 md:w-48 md:shrink-0 bg-muted/10">
					{/* Avatar */}
					{author?.avatar ? (
						<img
							src={author.avatar}
							alt={author.username}
							className="h-12 w-12 md:h-16 md:w-16 rounded-full object-cover"
						/>
					) : (
						<img
							src="/static/image/common/tavatar.gif"
							alt="默认头像"
							className="h-12 w-12 md:h-16 md:w-16 rounded-full object-cover bg-muted"
						/>
					)}

					<div className="flex flex-col items-start md:items-center gap-1 min-w-0">
						{/* Username */}
						<span className="font-medium text-sm truncate max-w-full">
							{author?.username ?? post.authorName}
						</span>

						{/* Role badge */}
						{author && (
							<Badge variant={roleBadgeVariant(author.role)} className="text-xs">
								{author.role > 0 && <Shield className="mr-1 h-3 w-3" />}
								{roleLabel(author.role)}
							</Badge>
						)}

						{/* User status (if banned/archived) */}
						{author && statusIndicator(author.status) && (
							<Badge variant="destructive" className="text-xs">
								{statusIndicator(author.status)}
							</Badge>
						)}

						{/* Stats */}
						{author && (
							<div className="flex flex-row md:flex-col gap-2 md:gap-0.5 text-xs text-muted-foreground mt-1">
								<span>帖子: {formatNumber(author.posts)}</span>
								<span>主题: {formatNumber(author.threads)}</span>
								<span>注册: {new Date(author.regDate * 1000).toLocaleDateString()}</span>
							</div>
						)}

						{/* Fallback when no author data */}
						{!author && <span className="text-xs text-muted-foreground">ID: {post.authorId}</span>}
					</div>
				</div>

				{/* Post content */}
				<div className="flex-1 p-4">
					<div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words">
						{post.content}
					</div>
				</div>
			</div>
		</div>
	);
}
