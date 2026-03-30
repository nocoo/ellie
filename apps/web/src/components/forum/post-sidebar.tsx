// components/forum/post-sidebar.tsx — Discuz-style left sidebar for desktop
// Desktop only (hidden md:flex), left-aligned layout matching classic Discuz

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import { formatUserRole, getUserRoleBadgeVariant } from "@/viewmodels/forum/user-profile";
import type { User } from "@ellie/types";
import Link from "next/link";

interface PostSidebarProps {
	author: User | null;
	isFirst: boolean;
	threadViews?: number;
	threadReplies?: number;
}

function authorInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

export function PostSidebar({ author, isFirst, threadViews, threadReplies }: PostSidebarProps) {
	return (
		<div className="hidden md:flex w-44 shrink-0 flex-col items-start gap-1 p-3">
			{/* Username — bold, left-aligned */}
			{author ? (
				<Link
					href={`/users/${author.id}`}
					className="text-sm font-bold text-foreground hover:text-primary transition-colors"
				>
					{author.username}
				</Link>
			) : (
				<span className="text-sm text-muted-foreground">未知用户</span>
			)}

			{/* Avatar */}
			<Link href={author ? `/users/${author.id}` : "#"} className="mt-1">
				<Avatar className="h-20 w-20 rounded">
					<AvatarFallback className="text-xl rounded">
						{author ? authorInitials(author.username) : "?"}
					</AvatarFallback>
				</Avatar>
			</Link>

			{/* Stats grid — centered 3-col with dividers */}
			{author && (
				<div className="mt-1.5 grid w-full grid-cols-3 text-center text-[10px] text-muted-foreground divide-x divide-border">
					<div className="px-1">
						<div className="font-medium text-primary">{author.threads.toLocaleString()}</div>
						<div>主题</div>
					</div>
					<div className="px-1">
						<div className="font-medium text-primary">{author.posts.toLocaleString()}</div>
						<div>帖子</div>
					</div>
					<div className="px-1">
						<div className="font-medium text-primary">{author.credits.toLocaleString()}</div>
						<div>积分</div>
					</div>
				</div>
			)}

			<Separator className="my-0.5" />

			{/* Detail rows — left-aligned */}
			{author && (
				<div className="space-y-0.5 text-xs text-muted-foreground">
					<div>
						<Badge variant={getUserRoleBadgeVariant(author.role)} className="text-[10px]">
							{formatUserRole(author.role)}
						</Badge>
					</div>
					<div>
						UID:{" "}
						<Link href={`/users/${author.id}`} className="text-primary hover:underline">
							{author.id}
						</Link>
					</div>
					<div>注册时间: {formatDate(author.regDate)}</div>
					<div>精华: 0</div>
				</div>
			)}

			{/* First-post stats */}
			{isFirst && threadViews !== undefined && threadReplies !== undefined && (
				<div className="text-xs text-muted-foreground">
					查看: {threadViews.toLocaleString()} / 回复: {threadReplies.toLocaleString()}
				</div>
			)}

			{/* Message link */}
			{author && (
				<span className="mt-0.5 text-xs text-primary cursor-pointer hover:underline">发消息</span>
			)}
		</div>
	);
}
