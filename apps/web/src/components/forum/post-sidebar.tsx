// components/forum/post-sidebar.tsx — Discuz classic left sidebar for desktop
// Light blue background, bordered stats grid, group/level, credits, mod row.

import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import { formatCheckinDays, formatCheckinLevel } from "@/viewmodels/forum/user-profile";
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
	const checkinLevel = author ? formatCheckinLevel(author.checkin) : null;
	const checkinDays = author ? formatCheckinDays(author.checkin?.totalDays) : null;
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
				<span className="text-sm text-muted-foreground">未知用户</span>
			)}

			{/* Avatar — photo-frame: white padding + shadow */}
			{author ? (
				<UserPopover
					userId={author.id}
					viewerRole={viewerRole}
					viewerUserId={viewerUserId}
					align="start"
				>
					<div className="mt-1 bg-card p-1 lg:p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)] dark:shadow-[0_0_3px_rgba(255,255,255,0.12)] cursor-pointer">
						<UserAvatar
							src={getAvatarUrl(author.id, "big", author.avatarPath)}
							alt={author.username}
							className="block w-[120px] lg:w-[160px] h-auto"
						/>
					</div>
				</UserPopover>
			) : (
				<div className="mt-1 bg-card p-1 lg:p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)] dark:shadow-[0_0_3px_rgba(255,255,255,0.12)]">
					<img
						src={getStaticImageUrl("tavatar.gif")}
						alt="默认头像"
						className="block w-[120px] lg:w-[160px] h-auto"
					/>
				</div>
			)}

			{/* Check-in compact block — Lv. label + cumulative days, sits above stats grid */}
			{author && (checkinLevel || checkinDays) && (
				<div className="mt-2 w-full text-center">
					{checkinLevel && (
						<div className="text-xs font-medium text-forum-link truncate" title={checkinLevel}>
							{checkinLevel}
						</div>
					)}
					{checkinDays && (
						<div className="text-2xs text-muted-foreground truncate" title={checkinDays}>
							{checkinDays}
						</div>
					)}
				</div>
			)}

			{/* Stats grid — 3 columns with vertical dividers, no border */}
			{author && (
				<div className="mt-2 grid w-full grid-cols-3 text-center divide-x divide-border">
					<div className="py-1 px-0.5">
						<div className="text-sm font-medium text-forum-link">
							{formatNumber(author.threads)}
						</div>
						<div className="text-2xs text-muted-foreground">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="text-sm font-medium text-forum-link">{formatNumber(author.posts)}</div>
						<div className="text-2xs text-muted-foreground">回复</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="text-sm font-medium text-forum-link">
							{formatNumber(author.credits)}
						</div>
						<div className="text-2xs text-muted-foreground">积分</div>
					</div>
				</div>
			)}

			{/* Detail rows — aligned label:value pairs */}
			{author && (
				<div className="w-full space-y-1 text-xs text-muted-foreground mt-1">
					{/* Campus — top of detail block, hidden when empty */}
					{author.campus && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">校区:</span>
							<span className="text-right truncate">{author.campus}</span>
						</div>
					)}

					{/* Group title + level */}
					{author.groupTitle && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">头衔:</span>
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
							<span className="shrink-0 text-muted-foreground">等级:</span>
							<span>Lv.{author.groupStars}</span>
						</div>
					)}

					{/* Custom title */}
					{author.customTitle && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">自定义:</span>
							<span className="italic text-right truncate">{author.customTitle}</span>
						</div>
					)}

					{/* UID */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-muted-foreground">UID:</span>
						<Link
							href={`/users/${author.id}`}
							prefetch={false}
							className="text-forum-link hover:underline"
						>
							{author.id}
						</Link>
					</div>

					{/* Credits */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-muted-foreground">同钱:</span>
						<span>{formatNumber(author.coins ?? 0)}</span>
					</div>

					{/* Registration date */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-muted-foreground">注册:</span>
						<span>{formatDate(author.regDate)}</span>
					</div>

					{/* Online time */}
					{author.olTime > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">在线:</span>
							<span>{formatNumber(author.olTime)} 小时</span>
						</div>
					)}

					{/* Digest posts */}
					{author.digestPosts > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">精华:</span>
							<span>{formatNumber(author.digestPosts)}</span>
						</div>
					)}

					{/* Thread stats — first post only */}
					{isFirst && threadViews !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">查看:</span>
							<span>{formatNumber(threadViews)}</span>
						</div>
					)}
					{isFirst && threadReplies !== undefined && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-muted-foreground">回复:</span>
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
						prefetch={false}
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
