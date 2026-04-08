// components/forum/post-sidebar.tsx — Discuz classic left sidebar for desktop
// Light blue background, bordered stats grid, group/level, credits, mod row.

import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { User } from "@ellie/types";
import { Mail } from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface PostSidebarProps {
	author: User | null;
	isFirst: boolean;
	threadViews?: number;
	threadReplies?: number;
	/** Current viewer's role for popover permission checks */
	viewerRole?: number;
	/** Current viewer's user ID */
	viewerUserId?: number | null;
}

export function PostSidebar({
	author,
	isFirst,
	threadViews,
	threadReplies,
	viewerRole = 0,
	viewerUserId = null,
}: PostSidebarProps) {
	return (
		<div className="w-[160px] lg:w-[200px] shrink-0 bg-forum-sidebar-bg border-r border-border p-3 lg:p-4 flex flex-col items-center gap-1.5">
			{/* Username — bold, link color */}
			{author ? (
				<UserPopover
					userId={author.id}
					viewerRole={viewerRole}
					viewerUserId={viewerUserId}
					align="start"
				>
					<span className="text-sm font-bold text-forum-link hover:underline cursor-pointer">
						{author.username}
					</span>
				</UserPopover>
			) : (
				<span className="text-sm text-forum-text-muted">未知用户</span>
			)}

			{/* Avatar — photo-frame: white padding + shadow */}
			{author ? (
				<UserPopover
					userId={author.id}
					viewerRole={viewerRole}
					viewerUserId={viewerUserId}
					align="start"
				>
					<div className="mt-1 bg-card p-1 lg:p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)] cursor-pointer">
						<UserAvatar
							src={getAvatarUrl(author.id, "big")}
							alt={author.username}
							className="block w-[120px] lg:w-[160px] h-auto"
						/>
					</div>
				</UserPopover>
			) : (
				<div className="mt-1 bg-card p-1 lg:p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)]">
					<img
						src={getStaticImageUrl("tavatar.gif")}
						alt="默认头像"
						className="block w-[120px] lg:w-[160px] h-auto"
					/>
				</div>
			)}

			{/* Stats grid — 3 columns with vertical dividers, no border */}
			{author && (
				<div className="mt-2 grid w-full grid-cols-3 text-center text-2xs divide-x divide-border">
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{formatNumber(author.threads)}</div>
						<div className="text-xs text-muted-foreground">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{formatNumber(author.posts)}</div>
						<div className="text-xs text-muted-foreground">回复</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="font-medium text-forum-link">{formatNumber(author.credits)}</div>
						<div className="text-xs text-muted-foreground">积分</div>
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
						<span>{formatNumber(author.credits)}</span>
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
							<span>{formatNumber(author.olTime)} 小时</span>
						</div>
					)}

					{/* Digest posts */}
					{author.digestPosts > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">精华:</span>
							<span>{formatNumber(author.digestPosts)}</span>
						</div>
					)}

					{/* Thread stats — first post only */}
					{isFirst && threadViews !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">查看:</span>
							<span>{formatNumber(threadViews)}</span>
						</div>
					)}
					{isFirst && threadReplies !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-forum-text-muted">回复:</span>
							<span>{formatNumber(threadReplies)}</span>
						</div>
					)}
				</div>
			)}

			{/* Message link */}
			{author && (
				<div className="flex items-center gap-3 mt-1 self-start">
					<Link
						href={`/messages?to=${author.id}`}
						className="flex items-center gap-1 text-xs text-forum-link hover:underline"
					>
						<Mail className="h-3.5 w-3.5" />
						发站内信
					</Link>
				</div>
			)}
		</div>
	);
}
