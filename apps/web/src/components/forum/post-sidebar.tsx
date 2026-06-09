// components/forum/post-sidebar.tsx — Discuz classic left sidebar for desktop
// Light blue background, bordered stats grid, group/level, credits, mod row.

import type { User } from "@ellie/types";
import Link from "next/link";
import { getAvatarUrl } from "@/lib/avatar";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatDate } from "@/viewmodels/forum/thread-detail";
import { formatCheckinDays, formatCheckinLevel } from "@/viewmodels/forum/user-profile";
import { formatNumber } from "@/viewmodels/shared/formatting";
import { PostSidebarMessageButton } from "./post-sidebar-message-button";
import { UserAvatar } from "./user-avatar";
import { UserPopover } from "./user-popover";

interface PostSidebarProps {
	author: User | null;
	/** Current viewer's role for popover permission checks */
	viewerRole?: number;
	/** Current viewer's user ID */
	viewerUserId?: number | null;
	/**
	 * True when the post was originally posted anonymously (Discuz convention,
	 * mig 0047). Renders "匿名" with no profile link instead of the
	 * "未知用户" fallback used for genuinely missing users.
	 */
	isAnonymous?: boolean;
}

export function PostSidebar({
	author,
	viewerRole = 0,
	viewerUserId = null,
	isAnonymous = false,
}: PostSidebarProps) {
	// When the post is anonymous, the API masks `authorId=0` so `authorMap`
	// returns null. Render the "匿名" identity card instead of the
	// missing-user fallback so the anonymous social contract holds.
	if (isAnonymous) {
		return (
			<div className="w-[160px] lg:w-[200px] shrink-0 bg-forum-sidebar-bg border-r border-border p-3 lg:p-4 flex flex-col items-center gap-1.5">
				<span className="text-xs font-bold text-muted-foreground" data-testid="post-sidebar-author">
					匿名
				</span>
				<div className="mt-1 bg-card p-1 lg:p-[5px] shadow-[0_0_3px_rgba(0,0,0,0.2)] dark:shadow-[0_0_3px_rgba(255,255,255,0.12)]">
					<img
						src={getStaticImageUrl("tavatar.gif")}
						alt="匿名"
						className="block w-[120px] lg:w-[160px] h-auto"
					/>
				</div>
			</div>
		);
	}

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
					<span
						className="text-xs font-bold text-forum-link hover:underline cursor-pointer"
						data-testid="post-sidebar-author"
					>
						{author.username}
					</span>
				</UserPopover>
			) : (
				<span className="text-xs text-muted-foreground" data-testid="post-sidebar-author">
					未知用户
				</span>
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

			{/* Identity card — checkin level/days + campus + group title + custom title,
			   centered as a single block to set it apart from the data list below. */}
			{author &&
				(checkinLevel ||
					checkinDays ||
					author.campus ||
					author.groupTitle ||
					author.customTitle) && (
					<div className="mt-2 w-full text-center space-y-0.5">
						{checkinLevel && (
							<div className="text-xs font-medium text-forum-link truncate" title={checkinLevel}>
								{checkinLevel}
							</div>
						)}
						{checkinDays && (
							<div
								className="text-xs text-muted-foreground truncate"
								title={checkinDays}
								data-testid="post-sidebar-checkin-days"
							>
								{checkinDays}
							</div>
						)}
						{author.campus && (
							<div className="text-xs text-muted-foreground truncate" title={author.campus}>
								{author.campus}
							</div>
						)}
						{author.groupTitle && (
							<div
								className="text-xs font-medium truncate"
								style={author.groupColor ? { color: author.groupColor } : undefined}
								title={author.groupTitle}
							>
								{author.groupTitle}
							</div>
						)}
						{author.customTitle && (
							<div
								className="text-xs italic text-muted-foreground truncate"
								title={author.customTitle}
							>
								{author.customTitle}
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
						<div className="text-xs leading-3 text-muted-foreground">主题</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="text-sm font-medium text-forum-link">{formatNumber(author.posts)}</div>
						<div className="text-xs leading-3 text-muted-foreground">回复</div>
					</div>
					<div className="py-1 px-0.5">
						<div className="text-sm font-medium text-forum-link">
							{formatNumber(author.credits)}
						</div>
						<div className="text-xs leading-3 text-muted-foreground">积分</div>
					</div>
				</div>
			)}

			{/* Detail rows — aligned label:value pairs, separated from identity card above */}
			{author && (
				<div className="w-full space-y-1 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
					{/* UID */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-xs leading-3 text-muted-foreground">UID:</span>
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
						<span className="shrink-0 text-xs leading-3 text-muted-foreground">同钱:</span>
						<span>{formatNumber(author.coins ?? 0)}</span>
					</div>

					{/* Registration date */}
					<div className="flex items-baseline justify-between gap-1">
						<span className="shrink-0 text-xs leading-3 text-muted-foreground">注册:</span>
						<span>{formatDate(author.regDate)}</span>
					</div>

					{/* Online time */}
					{author.olTime > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-xs leading-3 text-muted-foreground">在线:</span>
							<span>{formatNumber(author.olTime)} 小时</span>
						</div>
					)}

					{/* Digest posts */}
					{author.digestPosts > 0 && (
						<div className="flex items-baseline justify-between gap-1">
							<span className="shrink-0 text-xs leading-3 text-muted-foreground">精华:</span>
							<span>{formatNumber(author.digestPosts)}</span>
						</div>
					)}
				</div>
			)}

			{/* Message link — gated by writeGatePreflight */}
			{author && (
				<div className="flex items-center gap-3 mt-1 self-start">
					<PostSidebarMessageButton userId={author.id} username={author.username} />
				</div>
			)}
		</div>
	);
}
