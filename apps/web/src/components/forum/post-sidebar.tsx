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
		<div className="w-[200px] shrink-0 bg-[#F5F8FA] border-r border-[#CFCFCF] p-4 flex flex-col items-center gap-1.5">
			{/* Username — bold, link color */}
			{author ? (
				<Link
					href={`/users/${author.id}`}
					className="text-sm font-bold text-[#3672A0] hover:underline"
				>
					{author.username}
				</Link>
			) : (
				<span className="text-sm text-[#999]">未知用户</span>
			)}

			{/* Avatar — photo-frame: white padding + shadow */}
			<Link href={author ? `/users/${author.id}` : "#"} className="mt-1">
				{author ? (
					<div className="bg-white p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)]">
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
				<div className="mt-2 grid w-full grid-cols-3 text-center text-[11px] divide-x divide-[#CFCFCF]">
					<div className="py-1 px-0.5">
						<div className="font-medium text-[#3672A0]">{author.threads.toLocaleString()}</div>
						<div className="text-[#999]">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-[#3672A0]">{author.posts.toLocaleString()}</div>
						<div className="text-[#999]">帖子</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-[#3672A0]">{author.credits.toLocaleString()}</div>
						<div className="text-[#999]">积分</div>
					</div>
				</div>
			)}

			{/* Detail rows */}
			{author && (
				<div className="w-full space-y-1 text-xs text-[#666] mt-1">
					{/* Group title + level */}
					{author.groupTitle && (
						<div className="text-center">
							<span
								className="font-medium"
								style={author.groupColor ? { color: author.groupColor } : undefined}
							>
								{author.groupTitle}
							</span>
							{author.groupStars > 0 && (
								<span className="ml-1 text-[#666]">Lv.{author.groupStars}</span>
							)}
						</div>
					)}

					{/* Custom title */}
					{author.customTitle && (
						<div className="text-center text-[#999] italic">{author.customTitle}</div>
					)}

					{/* UID */}
					<div>
						UID:{" "}
						<Link href={`/users/${author.id}`} className="text-[#3672A0] hover:underline">
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
				<div className="text-xs text-[#666]">
					查看: {threadViews.toLocaleString()} / 回复: {threadReplies.toLocaleString()}
				</div>
			)}

			{/* Send message link */}
			{author && (
				<span className="flex items-center gap-1 text-xs text-[#3672A0] cursor-pointer hover:underline mt-1">
					<Mail className="h-3.5 w-3.5" />
					发消息
				</span>
			)}

			{/* Mod action row */}
			{author && (
				<div className="flex items-center gap-2 text-[11px] text-[#999] mt-2 flex-wrap justify-center">
					<span className="hover:text-[#3672A0] cursor-pointer">IP</span>
					<span className="hover:text-[#3672A0] cursor-pointer">编辑</span>
					<span className="hover:text-[#3672A0] cursor-pointer">禁止</span>
					<span className="hover:text-[#3672A0] cursor-pointer">帖子</span>
					<span className="hover:text-[#3672A0] cursor-pointer">清理</span>
				</div>
			)}
		</div>
	);
}
