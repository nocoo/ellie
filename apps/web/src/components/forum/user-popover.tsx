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
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { PublicUser, UserRole } from "@ellie/types";
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
	/** Current viewer's role (0=user, 1=admin, 2=supermod, 3=mod) */
	viewerRole?: number;
	/** Current viewer's user ID (null if not logged in) */
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

function getRoleBadge(role: UserRole): { label: string; variant: "default" | "secondary" | "outline" } | null {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserPopover({
	userId,
	children,
	viewerRole = 0,
	viewerUserId = null,
	side = "bottom",
	align = "start",
	disabled = false,
}: UserPopoverProps) {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState<UserPopoverData | null>(null);
	const [error, setError] = useState<string | null>(null);

	const isAdmin = viewerRole >= 1 && viewerRole <= 2;
	const isMod = viewerRole >= 1 && viewerRole <= 3;
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

	// Fetch user data when popover opens
	useEffect(() => {
		if (open && !data) {
			fetchUser();
		}
	}, [open, data, fetchUser]);

	// Reset data when userId changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: userId is intentionally a dependency to reset state
	useEffect(() => {
		setData(null);
		setError(null);
	}, [userId]);

	if (disabled) {
		return <>{children}</>;
	}

	const user = data?.user;
	const roleBadge = user ? getRoleBadge(user.role) : null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className="cursor-pointer">{children}</PopoverTrigger>
			<PopoverContent
				side={side}
				align={align}
				className={cn(
					"w-[320px] p-0 overflow-hidden",
					"glass-panel",
				)}
			>
				{/* Loading state */}
				{loading && (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				)}

				{/* Error state */}
				{error && !loading && (
					<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
						<UserIcon className="h-8 w-8 text-muted-foreground mb-2" />
						<p className="text-sm text-muted-foreground">{error}</p>
						<Button variant="ghost" size="sm" className="mt-2" onClick={fetchUser}>
							重试
						</Button>
					</div>
				)}

				{/* User data */}
				{user && !loading && (
					<>
						{/* Header: Avatar + Name + Badges */}
						<div className="relative">
							{/* Background gradient */}
							<div className="absolute inset-0 h-20 bg-gradient-to-b from-primary/10 to-transparent" />

							<div className="relative px-4 pt-4 pb-3">
								<div className="flex items-start gap-3">
									{/* Avatar */}
									<Link href={`/users/${user.id}`} onClick={() => setOpen(false)}>
										<div className="bg-card p-1 rounded-lg shadow-md ring-1 ring-border/50">
											<UserAvatar
												src={getAvatarUrl(user.id, "middle")}
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
												onClick={() => setOpen(false)}
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
									</div>
								</div>
							</div>
						</div>

						{/* Stats grid */}
						<div className="grid grid-cols-4 gap-px bg-border/50 mx-4 rounded-lg overflow-hidden">
							<StatItem label="主题" value={formatNumber(user.threads)} />
							<StatItem label="帖子" value={formatNumber(user.posts)} />
							<StatItem label="积分" value={formatNumber(user.credits)} />
							<StatItem label="精华" value={formatNumber(user.digestPosts)} />
						</div>

						{/* Detail rows */}
						<div className="px-4 py-3 space-y-2">
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
							{user.olTime > 0 && (
								<DetailRow
									icon={<Star className="h-3.5 w-3.5" />}
									label="在线时长"
									value={`${formatNumber(user.olTime)} 小时`}
								/>
							)}

							{/* Bio preview */}
							{user.bio && (
								<div className="pt-1">
									<p className="text-xs text-muted-foreground line-clamp-2">{user.bio}</p>
								</div>
							)}
						</div>

						{/* Admin-only section */}
						{isAdmin && (
							<div className="px-4 py-2 border-t border-border/50 bg-muted/30">
								<p className="text-2xs text-muted-foreground mb-2 flex items-center gap-1">
									<Shield className="h-3 w-3" />
									管理员信息
								</p>
								<div className="space-y-1.5 text-xs">
									<div className="flex justify-between">
										<span className="text-muted-foreground">UID</span>
										<span className="font-mono text-foreground">{user.id}</span>
									</div>
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
						)}

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
										私信
									</Link>
								)}

								{/* Mod actions */}
								{isMod && !isSelf && (
									<Button
										variant="ghost"
										size="xs"
										className="text-xs gap-1 text-muted-foreground"
										title="管理操作"
									>
										<Shield className="h-3.5 w-3.5" />
										管理
									</Button>
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
