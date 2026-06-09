"use client";

import { formatNumber } from "@ellie/shared";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@ellie/ui";
import { MoreHorizontal, Pencil, Shield, Trash2 } from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "@/components/admin/user-avatar";
import { FIRST_POST_VARIANT, userRoleVariant, userStatusVariant } from "@/viewmodels/admin/badges";
import type { EnrichedPost } from "@/viewmodels/admin/thread-detail";
import { roleLabel } from "@/viewmodels/admin/users";

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
			<div className="flex items-center justify-between border-b border-border/50 bg-background/30 px-4 py-2">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<span className="font-mono font-medium text-foreground">#{post.position}</span>
					{post.isFirst && <Badge variant={FIRST_POST_VARIANT}>楼主</Badge>}
					<span>{formatDate(post.createdAt)}</span>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								aria-label={`打开第 ${post.position} 楼操作菜单`}
								className="h-7 w-7"
							>
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
				<div className="flex md:flex-col items-center md:items-center gap-3 md:gap-2 border-b md:border-b-0 md:border-r p-4 md:w-48 md:shrink-0 bg-background/10">
					{/* Avatar — falls back to default tavatar.gif via UserAvatar onError. */}
					<UserAvatar
						uid={author?.id ?? post.authorId}
						username={author?.username ?? post.authorName}
						avatarPath={author?.avatarPath}
						className="md:h-16 md:w-16 h-12 w-12"
					/>

					<div className="flex flex-col items-start md:items-center gap-1 min-w-0">
						{/* Username — link to user detail when we have a usable id */}
						{(() => {
							const linkId = author?.id ?? post.authorId;
							const displayName = author?.username ?? post.authorName;
							return linkId > 0 ? (
								<Link
									href={`/admin/users/${linkId}`}
									className="font-medium text-sm truncate max-w-full text-primary hover:underline"
								>
									{displayName}
								</Link>
							) : (
								<span className="font-medium text-sm truncate max-w-full">{displayName}</span>
							);
						})()}

						{/* Role badge */}
						{author && (
							<Badge variant={userRoleVariant(author.role)} className="text-xs">
								{author.role > 0 && <Shield className="mr-1 h-3 w-3" />}
								{roleLabel(author.role)}
							</Badge>
						)}

						{/* User status (if banned/archived) */}
						{author && statusIndicator(author.status) && (
							<Badge variant={userStatusVariant(author.status)} className="text-xs">
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
