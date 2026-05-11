"use client";

// components/forum/user-popover.tsx — Universal user info popover
// Displays user profile card on avatar/name click throughout the forum.
// - Public users see basic info (stats, group, registration)
// - Admins see additional moderation controls and private info
// - Includes "View Profile" link to full user page

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiClient } from "@/lib/api-client";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { formatLocaleDate, formatNumber } from "@/viewmodels/shared/formatting";
import { formatLastActive, getRoleBadge } from "@/viewmodels/shared/user-display";
import type { PublicUser } from "@ellie/types";
import { isUserBanned, isUserMuted } from "@ellie/types";
import {
	Calendar,
	ChevronRight,
	Clock,
	ExternalLink,
	Loader2,
	Mail,
	Shield,
	Star,
	User as UserIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useForumToast } from "./forum-toast";
import { UserAvatar } from "./user-avatar";
import {
	MOD_ACTION_CONFIG,
	type ModAction,
	type ModActionMessage,
	UserModActionDialog,
	UserModActionDropdown,
} from "./user-mod-action-controls";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserPopoverProps {
	/** User ID to fetch data for */
	userId: number;
	/** Trigger element (avatar, username link, etc.) */
	children: ReactNode;
	/**
	 * Current viewer's role (0=user, 1=admin, 2=supermod, 3=mod).
	 * @deprecated Prefer letting the component read from session internally.
	 * Kept for backward compatibility with existing call sites.
	 */
	viewerRole?: number;
	/**
	 * Current viewer's user ID (null if not logged in).
	 * @deprecated Prefer letting the component read from session internally.
	 */
	viewerUserId?: number | null;
	/** Side of the trigger to show popover */
	side?: "top" | "bottom" | "left" | "right";
	/** Alignment relative to trigger */
	align?: "start" | "center" | "end";
	/** Disable popover (just render children) */
	disabled?: boolean;
	/** Additional className applied to the PopoverTrigger element */
	triggerClassName?: string;
}

interface UserPopoverData {
	user: PublicUser;
	isOnline?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserPopover({
	userId,
	children,
	viewerRole: viewerRoleProp,
	viewerUserId: viewerUserIdProp,
	side = "bottom",
	align = "start",
	disabled = false,
	triggerClassName,
}: UserPopoverProps) {
	const { data: session } = useSession();
	const toast = useForumToast();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState<UserPopoverData | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Mod action states
	const [modAction, setModAction] = useState<ModAction>(null);
	const [modActionLoading, setModActionLoading] = useState(false);
	const [modActionMessage, setModActionMessage] = useState<ModActionMessage | null>(null);

	// User status for moderation (fetched separately for admins)
	const [userStatus, setUserStatus] = useState<number | null>(null);

	// Resolve viewer identity: prefer props (for backward compat), fall back to session
	const viewerRole = viewerRoleProp ?? session?.user?.role ?? 0;
	const viewerUserId =
		viewerUserIdProp ?? (session?.user?.id ? Number.parseInt(session.user.id, 10) : null);

	// Staff: Admin (1), SuperMod (2), Mod (3) — can see admin info section (IP, etc.)
	const isStaff = viewerRole >= 1;
	// Can manage users (mute/ban/nuke): Admin (1) or SuperMod (2) only
	// Matches canAccessAdmin() in @ellie/types and Worker moderation handlers
	const canManageUsers = viewerRole === 1 || viewerRole === 2;
	const isSelf = viewerUserId === userId;

	const fetchUser = useCallback(async () => {
		if (data?.user.id === userId) return; // Already loaded
		setLoading(true);
		setError(null);
		try {
			const res = await apiClient.get<PublicUser>(`/api/v1/users/${userId}`);
			setData({ user: res.data });
		} catch {
			setError("无法加载用户信息");
		} finally {
			setLoading(false);
		}
	}, [userId, data?.user.id]);

	// Fetch user status for moderation (Admin/SuperMod only)
	const fetchUserStatus = useCallback(async () => {
		if (!canManageUsers || isSelf) return;
		try {
			const res = await apiClient.get<{ status: number }>(
				`/api/v1/moderation/users/${userId}/status`,
			);
			setUserStatus(res.data.status);
		} catch {
			// Silently ignore - status badge won't show
			setUserStatus(null);
		}
	}, [userId, canManageUsers, isSelf]);

	// Execute mod action
	const executeModAction = useCallback(async () => {
		if (!modAction || !data?.user) return;
		const config = MOD_ACTION_CONFIG[modAction];
		setModActionLoading(true);
		setModActionMessage(null);
		try {
			await apiClient.post(config.endpoint(userId), {});
			setModActionMessage({ type: "success", text: `${config.title}成功` });
			toast.success(`${config.title}成功`);
			// Refresh user data and status
			setData(null);
			setUserStatus(null);
			await Promise.all([fetchUser(), fetchUserStatus()]);
		} catch (err) {
			const description = err instanceof Error ? err.message : "请稍后重试";
			setModActionMessage({
				type: "error",
				text: `${config.title}失败: ${description}`,
			});
			toast.error({ title: `${config.title}失败`, description });
		} finally {
			setModActionLoading(false);
			setModAction(null);
		}
	}, [modAction, userId, data?.user, fetchUser, fetchUserStatus, toast]);

	// Fetch user data when popover opens
	useEffect(() => {
		if (open && !data) {
			fetchUser();
		}
	}, [open, data, fetchUser]);

	// Fetch user status when popover opens and user data is loaded (for admins)
	useEffect(() => {
		if (open && data && canManageUsers && !isSelf && userStatus === null) {
			fetchUserStatus();
		}
	}, [open, data, canManageUsers, isSelf, userStatus, fetchUserStatus]);

	// Reset data when userId changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: userId is intentionally a dependency to reset state
	useEffect(() => {
		setData(null);
		setError(null);
		setUserStatus(null);
		setModActionMessage(null);
	}, [userId]);

	if (disabled) {
		return <>{children}</>;
	}

	const user = data?.user;
	const roleBadge = user ? getRoleBadge(user.role) : null;
	const userIsMuted = isUserMuted(userStatus);
	const userIsBanned = isUserBanned(userStatus);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className={cn("cursor-pointer", triggerClassName)}>{children}</PopoverTrigger>
			<PopoverContent
				side={side}
				align={align}
				className={cn("w-[320px] p-0 overflow-hidden", "glass-panel")}
			>
				{/* Loading state */}
				{loading && <PopoverLoading />}

				{/* Error state */}
				{error && !loading && <PopoverError error={error} onRetry={fetchUser} />}

				{/* User data */}
				{user && !loading && (
					<>
						{/* Header: Avatar + Name + Badges */}
						<UserHeader
							user={user}
							roleBadge={roleBadge}
							isSelf={isSelf}
							userIsMuted={userIsMuted}
							userIsBanned={userIsBanned}
							onClose={() => setOpen(false)}
						/>

						{/* Stats grid */}
						<div className="grid grid-cols-4 gap-px bg-border/50 mx-4 rounded-lg overflow-hidden">
							<StatItem label="主题" value={formatNumber(user.threads)} />
							<StatItem label="回复" value={formatNumber(user.posts)} />
							<StatItem label="积分" value={formatNumber(user.credits)} />
							<StatItem label="精华" value={formatNumber(user.digestPosts)} />
						</div>

						{/* Detail rows */}
						<div className="px-4 py-3 space-y-2">
							<DetailRow
								icon={<UserIcon className="h-3.5 w-3.5" />}
								label="UID"
								value={String(user.id)}
							/>
							<DetailRow
								icon={<Calendar className="h-3.5 w-3.5" />}
								label="注册时间"
								value={formatLocaleDate(user.regDate) ?? "未知"}
							/>
							<DetailRow
								icon={<Clock className="h-3.5 w-3.5" />}
								label="最后活动"
								value={formatLastActive(user.lastActivity)}
							/>
							<DetailRow
								icon={<Star className="h-3.5 w-3.5" />}
								label="在线时长"
								value={`${formatNumber(user.olTime)} 小时`}
							/>

							{/* Bio preview */}
							{user.bio && (
								<div className="pt-1">
									<p className="text-xs text-muted-foreground line-clamp-2">{user.bio}</p>
								</div>
							)}
						</div>

						{/* Staff-only section (Admin, SuperMod, Mod) */}
						{isStaff && <AdminInfoSection user={user} />}

						{/* Actions */}
						<div className="px-4 py-3 border-t border-border/50 flex items-center justify-between gap-2">
							<div className="flex items-center gap-1">
								{/* Send message */}
								{!isSelf && (
									<Link
										href={`/messages?to=${user.id}`}
										className="inline-flex items-center justify-center h-6 px-2 rounded-lg text-xs font-medium gap-1 hover:bg-muted transition-colors"
									>
										<Mail className="h-3.5 w-3.5" />
										发站内信
									</Link>
								)}

								{/* Mod actions dropdown */}
								{canManageUsers && !isSelf && (
									<UserModActionDropdown
										userIsMuted={userIsMuted}
										userIsBanned={userIsBanned}
										onAction={setModAction}
										align="start"
										side="top"
										trigger={
											<Button
												variant="ghost"
												size="xs"
												className="text-xs gap-1 text-muted-foreground"
												title="管理操作"
											>
												<Shield className="h-3.5 w-3.5" />
												管理
											</Button>
										}
									/>
								)}
							</div>

							{/* View profile link */}
							<Link
								href={`/users/${user.id}`}
								onClick={() => setOpen(false)}
								className="inline-flex items-center justify-center h-6 px-2 rounded-lg border border-border bg-background text-xs font-medium gap-1 hover:bg-muted transition-colors"
							>
								查看主页
								<ChevronRight className="h-3.5 w-3.5" />
							</Link>
						</div>

						{/* Mod action confirmation dialog */}
						{modAction && (
							<UserModActionDialog
								modAction={modAction}
								username={user.username}
								message={modActionMessage}
								loading={modActionLoading}
								onClose={() => setModAction(null)}
								onConfirm={executeModAction}
							/>
						)}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="bg-card/80 py-2 px-1 text-center">
			<div className="text-sm font-semibold text-foreground">{value}</div>
			<div className="text-2xs text-muted-foreground">{label}</div>
		</div>
	);
}

function DetailRow({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center justify-between text-xs">
			<span className="flex items-center gap-1.5 text-muted-foreground">
				{icon}
				{label}
			</span>
			<span className="text-foreground">{value}</span>
		</div>
	);
}

/** Loading state for popover */
function PopoverLoading() {
	return (
		<div className="flex items-center justify-center py-12">
			<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	);
}

/** Error state for popover */
function PopoverError({ error, onRetry }: { error: string; onRetry: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
			<UserIcon className="h-8 w-8 text-muted-foreground mb-2" />
			<p className="text-sm text-muted-foreground">{error}</p>
			<Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
				重试
			</Button>
		</div>
	);
}

/** User header with avatar, name, badges */
function UserHeader({
	user,
	roleBadge,
	isSelf,
	userIsMuted,
	userIsBanned,
	onClose,
}: {
	user: PublicUser;
	roleBadge: { label: string; variant: "default" | "secondary" | "outline" } | null;
	isSelf: boolean;
	userIsMuted: boolean;
	userIsBanned: boolean;
	onClose: () => void;
}) {
	return (
		<div className="relative">
			{/* Background gradient */}
			<div className="absolute inset-0 h-20 bg-gradient-to-b from-primary/10 to-transparent" />

			<div className="relative px-4 pt-4 pb-3">
				<div className="flex items-start gap-3">
					{/* Avatar */}
					<Link href={`/users/${user.id}`} onClick={onClose}>
						<div className="bg-card p-1 rounded-lg shadow-md ring-1 ring-border/50">
							<UserAvatar
								src={getAvatarUrl(user.id, "middle", user.avatarPath)}
								alt={user.username}
								className="h-16 w-16 rounded-md"
							/>
						</div>
					</Link>

					{/* Info */}
					<div className="flex-1 min-w-0 pt-1">
						<div className="flex items-center gap-2 flex-wrap">
							<Link
								href={`/users/${user.id}`}
								onClick={onClose}
								className="text-base font-bold text-foreground hover:text-primary transition-colors truncate"
							>
								{user.username}
							</Link>
							{roleBadge && (
								<Badge variant={roleBadge.variant} className="text-2xs">
									{roleBadge.label}
								</Badge>
							)}
							{isSelf && (
								<Badge variant="outline" className="text-2xs">
									我
								</Badge>
							)}
						</div>

						{/* Group title */}
						{user.groupTitle && (
							<div className="flex items-center gap-1.5 mt-1">
								<span
									className="text-xs font-medium"
									style={user.groupColor ? { color: user.groupColor } : undefined}
								>
									{user.groupTitle}
								</span>
								{user.groupStars > 0 && (
									<span className="text-forum-accent text-xs">
										{"★".repeat(Math.min(user.groupStars, 5))}
									</span>
								)}
							</div>
						)}

						{/* Custom title */}
						{user.customTitle && (
							<p className="text-xs text-muted-foreground italic mt-0.5 truncate">
								{user.customTitle}
							</p>
						)}

						{/* User status badge */}
						<UserStatusBadges userIsMuted={userIsMuted} userIsBanned={userIsBanned} />
					</div>
				</div>
			</div>
		</div>
	);
}

/** User status badges (banned/muted) */
function UserStatusBadges({
	userIsMuted,
	userIsBanned,
}: {
	userIsMuted: boolean;
	userIsBanned: boolean;
}) {
	if (!userIsMuted && !userIsBanned) return null;
	return (
		<div className="mt-1">
			{userIsBanned && (
				<Badge variant="destructive" className="text-2xs">
					已封禁
				</Badge>
			)}
			{userIsMuted && !userIsBanned && (
				<Badge variant="outline" className="text-2xs text-forum-accent border-forum-accent">
					已禁言
				</Badge>
			)}
		</div>
	);
}

/** Admin-only info section */
function AdminInfoSection({ user }: { user: PublicUser }) {
	return (
		<div className="px-4 py-2 border-t border-border/50 bg-muted/30">
			<p className="text-2xs text-muted-foreground mb-2 flex items-center gap-1">
				<Shield className="h-3 w-3" />
				管理员信息
			</p>
			<div className="space-y-1.5 text-xs">
				{user.regIp && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">注册 IP</span>
						<span className="text-foreground font-mono text-2xs">{user.regIp}</span>
					</div>
				)}
				{user.lastIp && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">最后 IP</span>
						<span className="text-foreground font-mono text-2xs">{user.lastIp}</span>
					</div>
				)}
				{user.qq && (
					<div className="flex justify-between">
						<span className="text-muted-foreground">QQ</span>
						<span className="text-foreground">{user.qq}</span>
					</div>
				)}
				{user.site && (
					<div className="flex justify-between items-center">
						<span className="text-muted-foreground">网站</span>
						<a
							href={user.site.startsWith("http") ? user.site : `https://${user.site}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline truncate max-w-[160px] flex items-center gap-1"
						>
							{user.site}
							<ExternalLink className="h-3 w-3 shrink-0" />
						</a>
					</div>
				)}
			</div>
		</div>
	);
}
