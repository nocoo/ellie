"use client";

// components/forum/user-mod-actions.tsx — Shared user moderation actions
// Provides dropdown menu and confirmation dialogs for user moderation.
// Used by UserPopover and ProfileHero components.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForumToast } from "./forum-toast";
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
	const router = useRouter();
	const toast = useForumToast();
	// Can manage users (Admin or SuperMod only)
	const canManageUsers = viewerRole >= 1 && viewerRole <= 2;

	// State
	const [userStatus, setUserStatus] = useState<number | null>(null);
	const [modAction, setModAction] = useState<ModAction>(null);
	const [modActionLoading, setModActionLoading] = useState(false);
	const [modActionMessage, setModActionMessage] = useState<ModActionMessage | null>(null);

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
			toast.success(`${config.title}成功`);

			// For nuke action, redirect to home page after a short delay
			if (modAction === "nuke") {
				setTimeout(() => {
					router.push("/");
				}, 1000);
				return;
			}

			// Refresh status for other actions
			setUserStatus(null);
			await fetchUserStatus();
			onActionComplete?.();
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
	}, [modAction, userId, fetchUserStatus, onActionComplete, router, toast]);

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
			<UserModActionDropdown
				userIsMuted={userIsMuted}
				userIsBanned={userIsBanned}
				onAction={setModAction}
				align="end"
				trigger={
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

			{/* Confirmation dialog */}
			{modAction && (
				<UserModActionDialog
					modAction={modAction}
					username={username}
					message={modActionMessage}
					loading={modActionLoading}
					onClose={() => setModAction(null)}
					onConfirm={executeModAction}
				/>
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
			<Badge variant="outline" className="text-2xs text-forum-accent border-forum-accent">
				已禁言
			</Badge>
		);
	}
	return null;
}
