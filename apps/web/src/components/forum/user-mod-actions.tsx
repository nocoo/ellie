"use client";

// components/forum/user-mod-actions.tsx — Shared user moderation actions
// Provides dropdown menu and confirmation dialogs for user moderation.
// Used by UserPopover and ProfileHero components.

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
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Ban, Loader2, Shield, Trash2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserModActionsProps {
	/** Target user ID */
	userId: number;
	/** Target username (for display in dialogs) */
	username: string;
	/** Viewer's role (0=user, 1=admin, 2=supermod, 3=mod) */
	viewerRole: number;
	/** Whether this is the viewer's own profile */
	isSelf: boolean;
	/** Trigger variant */
	variant?: "button" | "icon";
	/** Button size */
	size?: "xs" | "sm" | "default";
	/** Callback when action completes */
	onActionComplete?: () => void;
	/** Optional className for the trigger */
	className?: string;
}

/** Moderation action type */
type ModAction = "mute" | "ban" | "nuke" | "unmute" | "unban" | null;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

export function UserModActions({
	userId,
	username,
	viewerRole,
	isSelf,
	variant = "button",
	size = "xs",
	onActionComplete,
	className,
}: UserModActionsProps) {
	// Can manage users (Admin or SuperMod only)
	const canManageUsers = viewerRole >= 1 && viewerRole <= 2;

	// State
	const [userStatus, setUserStatus] = useState<number | null>(null);
	const [modAction, setModAction] = useState<ModAction>(null);
	const [modActionLoading, setModActionLoading] = useState(false);
	const [modActionMessage, setModActionMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// Fetch user status
	const fetchUserStatus = useCallback(async () => {
		if (!canManageUsers || isSelf) return;
		try {
			const res = await apiClient.get<{ status: number }>(
				`/api/v1/moderation/users/${userId}/status`,
			);
			setUserStatus(res.data.status);
		} catch {
			setUserStatus(null);
		}
	}, [userId, canManageUsers, isSelf]);

	// Execute mod action
	const executeModAction = useCallback(async () => {
		if (!modAction) return;
		const config = MOD_ACTION_CONFIG[modAction];
		setModActionLoading(true);
		setModActionMessage(null);
		try {
			await apiClient.post(config.endpoint(userId), {});
			setModActionMessage({ type: "success", text: `${config.title}成功` });
			// Refresh status
			setUserStatus(null);
			await fetchUserStatus();
			onActionComplete?.();
		} catch (err) {
			setModActionMessage({
				type: "error",
				text: `${config.title}失败: ${err instanceof Error ? err.message : "请稍后重试"}`,
			});
		} finally {
			setModActionLoading(false);
			setModAction(null);
		}
	}, [modAction, userId, fetchUserStatus, onActionComplete]);

	// Fetch status on mount
	useEffect(() => {
		if (canManageUsers && !isSelf) {
			fetchUserStatus();
		}
	}, [canManageUsers, isSelf, fetchUserStatus]);

	// Don't render if can't manage users or is self
	if (!canManageUsers || isSelf) {
		return null;
	}

	const userIsMuted = userStatus === -2;
	const userIsBanned = userStatus === -1;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						variant === "icon" ? (
							<Button variant="ghost" size="icon" className={cn("h-8 w-8", className)}>
								<Shield className="h-4 w-4" />
							</Button>
						) : (
							<Button
								variant="ghost"
								size={size}
								className={cn("gap-1 text-muted-foreground", className)}
							>
								<Shield className="h-3.5 w-3.5" />
								管理
							</Button>
						)
					}
				/>
				<DropdownMenuContent align="end" className="min-w-[160px]">
					{/* IP records feature - disabled until IP tracking is implemented in database
					<DropdownMenuItem
						onClick={() => {
							window.location.href = `/admin/users/${userId}/ip-records`;
						}}
					>
						<Globe className="h-4 w-4" />
						查看 IP 记录
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					*/}
					{/* Mute/Unmute */}
					{userIsMuted ? (
						<DropdownMenuItem onClick={() => setModAction("unmute")}>
							<VolumeX className="h-4 w-4" />
							解除禁言
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem onClick={() => setModAction("mute")} disabled={userIsBanned}>
							<VolumeX className="h-4 w-4" />
							禁止发言
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					{/* Ban/Unban */}
					{userIsBanned ? (
						<DropdownMenuItem onClick={() => setModAction("unban")}>
							<Ban className="h-4 w-4" />
							解除封禁
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem variant="destructive" onClick={() => setModAction("ban")}>
							<Ban className="h-4 w-4" />
							封禁用户
						</DropdownMenuItem>
					)}
					{/* Nuke (only when not already banned) */}
					{!userIsBanned && (
						<DropdownMenuItem variant="destructive" onClick={() => setModAction("nuke")}>
							<Trash2 className="h-4 w-4" />
							封禁并删除内容
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Confirmation dialog */}
			{modAction && (
				<Dialog open={!!modAction} onOpenChange={(open) => !open && setModAction(null)}>
					<DialogContent showCloseButton={false} className="sm:max-w-[400px]">
						<DialogHeader>
							<DialogTitle>{MOD_ACTION_CONFIG[modAction].title}</DialogTitle>
							<DialogDescription>
								{MOD_ACTION_CONFIG[modAction].description(username)}
							</DialogDescription>
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
							<Button variant="outline" disabled={modActionLoading} onClick={() => setModAction(null)}>
								取消
							</Button>
							<Button
								variant={MOD_ACTION_CONFIG[modAction].variant}
								onClick={executeModAction}
								disabled={modActionLoading}
							>
								{modActionLoading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
								{MOD_ACTION_CONFIG[modAction].confirmText}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Status Badge Component
// ---------------------------------------------------------------------------

interface UserStatusBadgeProps {
	status: number | null;
}

export function UserStatusBadge({ status }: UserStatusBadgeProps) {
	if (status === -1) {
		return (
			<Badge variant="destructive" className="text-2xs">
				已封禁
			</Badge>
		);
	}
	if (status === -2) {
		return (
			<Badge variant="outline" className="text-2xs text-orange-500 border-orange-500">
				已禁言
			</Badge>
		);
	}
	return null;
}
