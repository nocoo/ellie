// components/forum/post-sidebar.tsx — Discuz-style left sidebar for desktop
// Desktop only (hidden md:flex), shows user info, stats, and thread metadata

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import { formatStat } from "@/viewmodels/forum/thread-list";
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
		<div className="hidden md:flex w-40 shrink-0 flex-col items-center gap-1.5 p-3 text-center">
			{/* First-post header: views / replies */}
			{isFirst && threadViews !== undefined && threadReplies !== undefined && (
				<div className="w-full rounded bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
					查看: {formatStat(threadViews)} | 回复: {formatStat(threadReplies)}
				</div>
			)}

			{/* Username */}
			{author ? (
				<Link
					href={`/users/${author.id}`}
					className="text-xs font-medium text-primary hover:underline"
				>
					{author.username}
				</Link>
			) : (
				<span className="text-xs text-muted-foreground">未知用户</span>
			)}

			{/* Avatar 60x60 */}
			<Link href={author ? `/users/${author.id}` : "#"}>
				<Avatar className="h-15 w-15 rounded">
					<AvatarFallback className="text-base rounded">
						{author ? authorInitials(author.username) : "?"}
					</AvatarFallback>
				</Avatar>
			</Link>

			{/* Role badge */}
			{author && (
				<Badge variant={getUserRoleBadgeVariant(author.role)} className="text-[10px]">
					{formatUserRole(author.role)}
				</Badge>
			)}

			<Separator />

			{/* Stats grid */}
			{author && (
				<div className="grid w-full grid-cols-3 gap-0.5 text-[10px] text-muted-foreground">
					<div>
						<div className="font-medium text-foreground">{author.threads.toLocaleString()}</div>
						<div>主题</div>
					</div>
					<div>
						<div className="font-medium text-foreground">{author.posts.toLocaleString()}</div>
						<div>帖子</div>
					</div>
					<div>
						<div className="font-medium text-foreground">{author.credits.toLocaleString()}</div>
						<div>积分</div>
					</div>
				</div>
			)}

			{/* Detail rows: UID + regDate */}
			{author && (
				<div className="w-full space-y-0.5 text-left text-[10px] text-muted-foreground">
					<div>UID: {author.id}</div>
					<div>注册: {formatDate(author.regDate)}</div>
				</div>
			)}

			{/* Message placeholder link */}
			{author && (
				<span className="text-[10px] text-primary cursor-pointer hover:underline">[发消息]</span>
			)}
		</div>
	);
}
