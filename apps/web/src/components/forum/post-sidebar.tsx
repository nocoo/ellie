// components/forum/post-sidebar.tsx — Discuz classic left sidebar for desktop
// Light blue background, bordered stats grid, group/level, credits, mod row.

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarUrl } from "@/lib/avatar";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import type { User } from "@ellie/types";
import { Mail, Shield } from "lucide-react";
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
							className="block w-[160px] h-auto"
						/>
					</div>
				) : (
					<Avatar className="h-[160px] w-[160px] rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]">
						<AvatarFallback className="text-3xl rounded-sm">?</AvatarFallback>
					</Avatar>
				)}
			</Link>

			{/* Stats grid — 3 columns with vertical dividers, no border */}
			{author && (
				<div className="mt-2 grid w-full grid-cols-3 text-center text-2xs divide-x divide-border">
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.threads.toLocaleString()}</div>
						<div className="text-[12px] text-forum-text-muted">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.posts.toLocaleString()}</div>
						<div className="text-[12px] text-forum-text-muted">帖子</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{author.credits.toLocaleString()}</div>
						<div className="text-[12px] text-forum-text-muted">积分</div>
					</div>
				</div>
			)}

			{/* Detail rows — aligned label:value pairs */}
			{author && (
				<div className="w-full space-y-1 text-xs text-muted-foreground mt-1">
					{/* Group title + level */}
					{author.groupTitle && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">头衔:</span>
							<span
								className="font-medium text-right"
								style={author.groupColor ? { color: author.groupColor } : undefined}
							>
								{author.groupTitle}
							</span>
						</div>
					)}

					{/* Level */}
					{author.groupStars > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">等级:</span>
							<span>Lv.{author.groupStars}</span>
						</div>
					)}

					{/* Custom title */}
					{author.customTitle && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">自定义:</span>
							<span className="italic text-right truncate">{author.customTitle}</span>
						</div>
					)}

					{/* UID */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-forum-text-muted">UID:</span>
						<Link href={`/users/${author.id}`} className="text-forum-link hover:underline">
							{author.id}
						</Link>
					</div>

					{/* Credits */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-forum-text-muted">同钱:</span>
						<span>{author.credits.toLocaleString()}</span>
					</div>

					{/* Registration date */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-forum-text-muted">注册:</span>
						<span>{formatDate(author.regDate)}</span>
					</div>

					{/* Online time */}
					{author.olTime > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">在线:</span>
							<span>{author.olTime.toLocaleString()} 小时</span>
						</div>
					)}

					{/* Digest posts */}
					{author.digestPosts > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">精华:</span>
							<span>{author.digestPosts}</span>
						</div>
					)}

					{/* Thread stats — first post only */}
					{isFirst && threadViews !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">查看:</span>
							<span>{threadViews.toLocaleString()}</span>
						</div>
					)}
					{isFirst && threadReplies !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">回复:</span>
							<span>{threadReplies.toLocaleString()}</span>
						</div>
					)}
				</div>
			)}

			{/* Send message link */}
			{author && (
				<Link
					href={`/messages?to=${author.id}`}
					className="flex items-center gap-1 text-xs text-forum-link hover:underline mt-1 self-start"
				>
					<Mail className="h-3.5 w-3.5" />
					发消息
				</Link>
			)}

			{/* Mod action button — visible to admins/mods */}
			{author && (
				<button
					type="button"
					className="flex items-center gap-1 text-xs text-forum-text-muted hover:text-forum-link cursor-pointer mt-2 self-start transition-colors"
					title="管理操作 (IP / 编辑 / 禁止 / 帖子 / 清理 / 发消息)"
				>
					<Shield className="h-3.5 w-3.5" />
					管理
				</button>
			)}
		</div>
	);
}
