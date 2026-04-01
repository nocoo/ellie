// components/forum/post-sidebar.tsx — Discuz classic left sidebar for desktop
// Light blue background, bordered stats grid, group/level, credits, mod row.

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import type { User } from "@ellie/types";
import { Mail } from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "./user-avatar";

interface PostSidebarProps {
	author: User | null;
	isFirst: boolean;
	threadViews?: number;
	threadReplies?: number;
}

export function PostSidebar({ author, isFirst, threadViews, threadReplies }: PostSidebarProps) {
	return (
		<div className="w-[200px] shrink-0 bg-forum-sidebar-bg border-r border-border p-4 flex flex-col items-center gap-1.5">
			{/* Username — bold, link color */}
			{author ? (
				<Link
					href={`/users/${author.id}`}
					className="text-sm font-bold text-forum-link hover:underline"
				>
					{author.username}
				</Link>
			) : (
				<span className="text-sm text-forum-text-muted">未知用户</span>
			)}

			{/* Avatar — photo-frame: white padding + shadow */}
			<Link href={author ? `/users/${author.id}` : "#"} className="mt-1">
				{author ? (
					<div className="bg-card p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)]">
						<UserAvatar
							src={getAvatarUrl(author.id, "big")}
							alt={author.username}
							className="block max-w-[140px] w-auto h-auto"
						/>
					</div>
				) : (
					<Avatar className="h-20 w-20 rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
						<AvatarFallback className="text-xl rounded-sm">?</AvatarFallback>
					</Avatar>
				)}
			</Link>

			{/* Stats grid — 3 columns with vertical dividers, no border */}
			{author && (
				<div className="mt-2 grid w-full grid-cols-3 text-center text-2xs divide-x divide-border">
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.threads.toLocaleString()}</div>
						<div className="text-forum-text-muted">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.posts.toLocaleString()}</div>
						<div className="text-forum-text-muted">帖子</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.credits.toLocaleString()}</div>
						<div className="text-forum-text-muted">积分</div>
					</div>
				</div>
			)}

			{/* Detail rows */}
			{author && (
				<div className="w-full space-y-1 text-xs text-muted-foreground mt-1">
					{/* Group title + level */}
					{author.groupTitle && (
						<div>
							<span
								className="font-medium"
								style={author.groupColor ? { color: author.groupColor } : undefined}
							>
								{author.groupTitle}
							</span>
							{author.groupStars > 0 && (
								<span className="ml-1 text-muted-foreground">Lv.{author.groupStars}</span>
							)}
						</div>
					)}

					{/* Custom title */}
					{author.customTitle && (
						<div className="text-forum-text-muted italic">{author.customTitle}</div>
					)}

					{/* UID */}
					<div>
						UID:{" "}
						<Link href={`/users/${author.id}`} className="text-forum-link hover:underline">
							{author.id}
						</Link>
					</div>

					{/* Credits */}
					<div>同钱: {author.credits.toLocaleString()}</div>

					{/* Registration date */}
					<div>注册时间: {formatDate(author.regDate)}</div>

					{/* Online time */}
					{author.olTime > 0 && <div>在线: {author.olTime.toLocaleString()} 小时</div>}

					{/* Digest posts */}
					{author.digestPosts > 0 && <div>精华: {author.digestPosts}</div>}
				</div>
			)}

			{/* First-post thread stats */}
			{isFirst && threadViews !== undefined && threadReplies !== undefined && (
				<div className="text-xs text-muted-foreground self-start">
					查看: {threadViews.toLocaleString()} / 回复: {threadReplies.toLocaleString()}
				</div>
			)}

			{/* Send message link */}
			{author && (
				<span className="flex items-center gap-1 text-xs text-forum-link cursor-pointer hover:underline mt-1 self-start">
					<Mail className="h-3.5 w-3.5" />
					发消息
				</span>
			)}

			{/* Mod action row */}
			{author && (
				<div className="flex items-center gap-2 text-2xs text-forum-text-muted mt-2 flex-wrap self-start">
					<span className="hover:text-forum-link cursor-pointer">IP</span>
					<span className="hover:text-forum-link cursor-pointer">编辑</span>
					<span className="hover:text-forum-link cursor-pointer">禁止</span>
					<span className="hover:text-forum-link cursor-pointer">帖子</span>
					<span className="hover:text-forum-link cursor-pointer">清理</span>
				</div>
			)}
		</div>
	);
}
