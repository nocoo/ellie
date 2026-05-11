"use client";

/**
 * user-mod-action-controls.tsx — Shared user moderation UI primitives.
 *
 * Exports:
 * - ModAction type
 * - MOD_ACTION_CONFIG (action metadata: title, description, confirm text, variant, endpoint)
 * - ModActionMessage type
 * - UserModActionDialog (confirmation dialog)
 * - UserModActionDropdown (dropdown menu items with mute/ban/nuke logic)
 *
 * Callers retain: permission checks, state management, API execution,
 * toast notifications, refresh/redirect behavior.
 */

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
import { cn } from "@/lib/utils";
import { Ban, Loader2, Trash2, VolumeX } from "lucide-react";
import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Moderation action type */
export type ModAction = "mute" | "ban" | "nuke" | "unmute" | "unban" | null;

/** Message shown inside the confirmation dialog after action attempt */
export interface ModActionMessage {
	type: "success" | "error";
	text: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const MOD_ACTION_CONFIG: Record<
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
// UserModActionDialog — confirmation dialog for a mod action
// ---------------------------------------------------------------------------

interface UserModActionDialogProps {
	modAction: Exclude<ModAction, null>;
	username: string;
	message: ModActionMessage | null;
	loading: boolean;
	onClose: () => void;
	onConfirm: () => void;
}

export function UserModActionDialog({
	modAction,
	username,
	message,
	loading,
	onClose,
	onConfirm,
}: UserModActionDialogProps) {
	const config = MOD_ACTION_CONFIG[modAction];
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent showCloseButton={false} className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>{config.title}</DialogTitle>
					<DialogDescription>{config.description(username)}</DialogDescription>
				</DialogHeader>
				{message && (
					<div
						className={cn(
							"text-sm px-3 py-2 rounded-md",
							message.type === "success"
								? "bg-success/15 text-success dark:bg-success/20"
								: "bg-destructive/15 text-destructive dark:bg-destructive/20",
						)}
					>
						{message.text}
					</div>
				)}
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" disabled={loading} onClick={onClose}>
						取消
					</Button>
					<Button variant={config.variant} onClick={onConfirm} disabled={loading}>
						{loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
						{config.confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// UserModActionDropdown — dropdown menu with mod action items
// ---------------------------------------------------------------------------

interface UserModActionDropdownProps {
	/** Whether the target user is currently muted */
	userIsMuted: boolean;
	/** Whether the target user is currently banned */
	userIsBanned: boolean;
	/** Callback when a mod action is selected */
	onAction: (action: Exclude<ModAction, null>) => void;
	/** Custom trigger element (must be a ReactElement for DropdownMenuTrigger render) */
	trigger: ReactElement;
	/** DropdownMenuContent align */
	align?: "start" | "center" | "end";
	/** DropdownMenuContent side */
	side?: "top" | "right" | "bottom" | "left";
}

export function UserModActionDropdown({
	userIsMuted,
	userIsBanned,
	onAction,
	trigger,
	align = "end",
	side,
}: UserModActionDropdownProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger} />
			<DropdownMenuContent align={align} side={side} className="min-w-[160px]">
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
