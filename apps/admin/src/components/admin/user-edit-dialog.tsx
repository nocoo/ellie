"use client";

import { Button } from "@ellie/ui";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ellie/ui";
import { Input } from "@ellie/ui";
import { Label } from "@ellie/ui";
import { Select } from "@ellie/ui";
import { cn } from "@ellie/ui/utils";
import type { User, UserUpdate } from "@/viewmodels/admin/users";
import { AlertCircle, Save, User as UserIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: User | null;
	loading?: boolean;
	error?: string | null;
	onSave: (id: number, data: UserUpdate) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
	{ value: 0, label: "正常" },
	{ value: -1, label: "已封禁" },
	{ value: -2, label: "已归档" },
];

const ROLE_OPTIONS = [
	{ value: 0, label: "普通会员" },
	{ value: 1, label: "管理员" },
	{ value: 2, label: "超级版主" },
	{ value: 3, label: "版主" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserEditDialog({
	open,
	onOpenChange,
	user,
	loading = false,
	error,
	onSave,
}: UserEditDialogProps) {
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [avatar, setAvatar] = useState("");
	const [status, setStatus] = useState(0);
	const [role, setRole] = useState(0);
	const [credits, setCredits] = useState(0);

	// Sync form when user changes
	useEffect(() => {
		if (user) {
			setUsername(user.username);
			setEmail(user.email);
			setAvatar(user.avatar);
			setStatus(user.status);
			setRole(user.role);
			setCredits(user.credits);
		}
	}, [user]);

	const handleSave = useCallback(() => {
		if (!user || loading) return;
		onSave(user.id, {
			username,
			email,
			avatar,
			status,
			role,
			credits,
		});
	}, [user, loading, onSave, username, email, avatar, status, role, credits]);

	const statusColor =
		status === 0 ? "text-success" : status === -1 ? "text-destructive" : "text-muted-foreground";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"w-[calc(100vw-2rem)] sm:w-[520px]",
					"max-h-[85vh] overflow-hidden flex flex-col",
					"rounded-xl p-0",
				)}
				showCloseButton={false}
			>
				{/* Header */}
				<DialogHeader className="px-5 pt-5 pb-4 border-b border-border/50">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
								<UserIcon className="h-5 w-5 text-primary" />
							</div>
							<div>
								<DialogTitle className="text-lg">编辑用户</DialogTitle>
								<DialogDescription className="text-xs mt-0.5">
									{user ? `UID: ${user.id}` : "用户信息"}
								</DialogDescription>
							</div>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => onOpenChange(false)}
							disabled={loading}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className="sr-only">关闭</span>
							<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
								<path
									d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
									fill="currentColor"
									fillRule="evenodd"
									clipRule="evenodd"
								/>
							</svg>
						</Button>
					</div>
				</DialogHeader>

				{/* Error display */}
				{error && (
					<div className="mx-5 mt-4 flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Form */}
				<div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
					{/* Basic Info Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							基本信息
						</h3>

						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-username">用户名</Label>
								<Input
									id="edit-username"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									maxLength={50}
									placeholder="输入用户名"
									disabled={loading}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="edit-email">邮箱地址</Label>
								<Input
									id="edit-email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									maxLength={255}
									placeholder="user@example.com"
									disabled={loading}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="edit-avatar">头像链接</Label>
								<div className="flex items-center gap-3">
									{avatar && (
										<img
											src={avatar}
											alt="Avatar preview"
											className="h-10 w-10 rounded-lg object-cover border border-border"
											onError={(e) => {
												e.currentTarget.style.display = "none";
											}}
										/>
									)}
									<Input
										id="edit-avatar"
										value={avatar}
										onChange={(e) => setAvatar(e.target.value)}
										placeholder="https://..."
										disabled={loading}
										className="flex-1"
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Status & Role Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							权限设置
						</h3>

						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-status" className="flex items-center justify-between">
									<span>账号状态</span>
									<span className={cn("text-xs", statusColor)}>
										{STATUS_OPTIONS.find((o) => o.value === status)?.label}
									</span>
								</Label>
								<Select
									id="edit-status"
									value={status}
									onChange={(e) => setStatus(Number(e.target.value))}
									options={STATUS_OPTIONS}
									disabled={loading}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="edit-role">用户角色</Label>
								<Select
									id="edit-role"
									value={role}
									onChange={(e) => setRole(Number(e.target.value))}
									options={ROLE_OPTIONS}
									disabled={loading}
								/>
							</div>
						</div>
					</div>

					{/* Credits Section */}
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-foreground flex items-center gap-2">
							<span className="h-1 w-1 rounded-full bg-primary" />
							积分管理
						</h3>

						<div className="grid gap-2">
							<Label htmlFor="edit-credits" className="flex items-center justify-between">
								<span>当前积分</span>
								<span className="text-xs text-muted-foreground">
									{credits >= 0 ? `+${credits}` : credits}
								</span>
							</Label>
							<Input
								id="edit-credits"
								type="number"
								value={credits}
								onChange={(e) => setCredits(Number(e.target.value))}
								disabled={loading}
							/>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={loading} className="gap-2">
							<Save className="h-4 w-4" />
							{loading ? "保存中..." : "保存更改"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
