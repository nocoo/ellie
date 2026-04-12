"use client";

// components/forum/user-popover.tsx — Universal user info popover
// Displays user profile card on avatar/name click throughout the forum.
// - Public users see basic info (stats, group, registration)
// - Admins see additional moderation controls and private info
// - Includes "View Profile" link to full user page

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiClient } from "@/lib/api-client";
import { getAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { PublicUser, UserRole } from "@ellie/types";
import {
	Ban,
	Calendar,
	ChevronRight,
	Clock,
	ExternalLink,
	Loader2,
	Mail,
	Shield,
	Star,
	Trash2,
	User as UserIcon,
	VolumeX,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { UserAvatar } from "./user-avatar";

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
}

interface UserPopoverData {
	user: PublicUser;
	isOnline?: boolean;
}

/** Moderation action type for confirmation dialog */
type ModAction = "mute" | "ban" | "nuke" | "unmute" | "unban" | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(timestamp: number): string {
	if (!timestamp) return "未知";
	const date = new Date(timestamp * 1000);
	return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

function formatLastActive(timestamp: number): string {
	if (!timestamp) return "从未";
	const now = Date.now();
	const diff = now - timestamp * 1000;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} 天前`;
	return formatDate(timestamp);
}

function getRoleBadge(
	role: UserRole,
): { label: string; variant: "default" | "secondary" | "outline" } | null {
	switch (role) {
		case 1:
			return { label: "管理员", variant: "default" };
		case 2:
			return { label: "超级版主", variant: "secondary" };
		case 3:
			return { label: "版主", variant: "secondary" };
		default:
			return null;
	}
}

/** Check if user is muted (status = -2) */
function isMuted(status: number | null): boolean {
	return status === -2;
}

/** Check if user is banned (status = -1) */
function isBanned(status: number | null): boolean {
	return status === -1;
}

/** Mod action configuration */
const MOD_ACTION_CONFIG: Record<
	Exclude<ModAction, null>,
	{
		title: string;
		description: (username: string) => string;
		confirmText: string;
		variant: "default" | "destructive";
		endpoint: (userId: number) => string;
	}
> = {
	mute: {
		title: "禁止发言",
		description: (u) => `确定禁止 ${u} 发言？禁言后该用户将无法发帖和回复。`,
		confirmText: "禁言",
		variant: "default",
		endpoint: (id) => `/api/v1/moderation/users/${id}/mute`,
	},
	unmute: {
		title: "解除禁言",
		description: (u) => `确定解除 ${u} 的禁言？该用户将恢复发帖权限。`,
		confirmText: "解除禁言",
		variant: "default",
		endpoint: (id) => `/api/v1/moderation/users/${id}/unmute`,
	},
	ban: {
		title: "封禁用户",
		description: (u) => `确定封禁 ${u}？封禁后该用户将无法访问论坛。`,
		confirmText: "封禁",
		variant: "destructive",
		endpoint: (id) => `/api/v1/moderation/users/${id}/ban`,
	},
	unban: {
		title: "解除封禁",
		description: (u) => `确定解除 ${u} 的封禁？该用户将恢复论坛访问权限。`,
		confirmText: "解除封禁",
		variant: "default",
		endpoint: (id) => `/api/v1/moderation/users/${id}/unban`,
	},
	nuke: {
		title: "封禁并删除内容",
		description: (u) => `确定封禁 ${u} 并删除其所有内容？此操作不可撤销！`,
		confirmText: "封禁并删除",
		variant: "destructive",
		endpoint: (id) => `/api/v1/moderation/users/${id}/nuke`,
	},
};

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
}: UserPopoverProps) {
	const { data: session } = useSession();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState<UserPopoverData | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Mod action states
	const [modAction, setModAction] = useState<ModAction>(null);
	const [modActionLoading, setModActionLoading] = useState(false);
	const [modActionMessage, setModActionMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// User status for moderation (fetched separately for admins)
	const [userStatus, setUserStatus] = useState<number | null>(null);

	// Resolve viewer identity: prefer props (for backward compat), fall back to session
	const viewerRole = viewerRoleProp ?? session?.user?.role ?? 0;
	const viewerUserId = viewerUserIdProp ?? (session?.user?.id ? Number.parseInt(session.user.id, 10) : null);

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
			// Refresh user data and status
			setData(null);
			setUserStatus(null);
			await Promise.all([fetchUser(), fetchUserStatus()]);
		} catch (err) {
			setModActionMessage({
				type: "error",
				text: `${config.title}失败: ${err instanceof Error ? err.message : "请稍后重试"}`,
			});
		} finally {
			setModActionLoading(false);
			setModAction(null);
		}
	}, [modAction, userId, data?.user, fetchUser, fetchUserStatus]);

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
	const userIsMuted = isMuted(userStatus);
	const userIsBanned = isBanned(userStatus);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className="cursor-pointer">{children}</PopoverTrigger>
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
								value={formatDate(user.regDate)}
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
									<ModActionsDropdown
										user={user}
										userIsMuted={userIsMuted}
										userIsBanned={userIsBanned}
										onAction={setModAction}
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
							<ModActionDialog
								modAction={modAction}
								username={user.username}
								modActionMessage={modActionMessage}
								modActionLoading={modActionLoading}
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
									<span className="text-amber-500 text-xs">
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
				<Badge variant="outline" className="text-2xs text-orange-500 border-orange-500">
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

/** Mod actions dropdown menu */
function ModActionsDropdown({
	user: _user,
	userIsMuted,
	userIsBanned,
	onAction,
}: {
	user: PublicUser;
	userIsMuted: boolean;
	userIsBanned: boolean;
	onAction: (action: ModAction) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
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
			<DropdownMenuContent align="start" side="top" className="min-w-[160px]">
				{/* Mute/Unmute */}
				{userIsMuted ? (
					<DropdownMenuItem onClick={() => onAction("unmute")}>
						<VolumeX className="h-4 w-4" />
						解除禁言
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onClick={() => onAction("mute")} disabled={userIsBanned}>
						<VolumeX className="h-4 w-4" />
						禁止发言
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				{/* Ban/Unban */}
				{userIsBanned ? (
					<DropdownMenuItem onClick={() => onAction("unban")}>
						<Ban className="h-4 w-4" />
						解除封禁
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem variant="destructive" onClick={() => onAction("ban")}>
						<Ban className="h-4 w-4" />
						封禁用户
					</DropdownMenuItem>
				)}
				{/* Nuke (only when not already banned) */}
				{!userIsBanned && (
					<DropdownMenuItem variant="destructive" onClick={() => onAction("nuke")}>
						<Trash2 className="h-4 w-4" />
						封禁并删除内容
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Mod action confirmation dialog */
function ModActionDialog({
	modAction,
	username,
	modActionMessage,
	modActionLoading,
	onClose,
	onConfirm,
}: {
	modAction: Exclude<ModAction, null>;
	username: string;
	modActionMessage: { type: "success" | "error"; text: string } | null;
	modActionLoading: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const config = MOD_ACTION_CONFIG[modAction];
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent showCloseButton={false} className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>{config.title}</DialogTitle>
					<DialogDescription>{config.description(username)}</DialogDescription>
				</DialogHeader>
				{modActionMessage && (
					<div
						className={cn(
							"text-sm px-3 py-2 rounded-md",
							modActionMessage.type === "success"
								? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
								: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
						)}
					>
						{modActionMessage.text}
					</div>
				)}
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" disabled={modActionLoading} onClick={onClose}>
						取消
					</Button>
					<Button variant={config.variant} onClick={onConfirm} disabled={modActionLoading}>
						{modActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
						{config.confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
