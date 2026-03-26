// components/admin/admin-user-actions.tsx — User action buttons
// Ref: 04c §用户管理 — ban/unban/role change actions via admin API
//
// Client component: calls /api/admin/users POST endpoint.

"use client";

import { Button } from "@/components/ui/button";
import { UserRole, UserStatus } from "@/models/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLE_OPTIONS = [
	{ value: UserRole.Admin, label: "Admin" },
	{ value: UserRole.SuperMod, label: "Super Mod" },
	{ value: UserRole.Mod, label: "Moderator" },
	{ value: UserRole.User, label: "Member" },
];

export interface AdminUserActionsProps {
	userId: number;
	status: number;
	role: number;
}

export function AdminUserActions({ userId, status, role }: AdminUserActionsProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleAction = async (action: "ban" | "unban") => {
		setLoading(true);
		try {
			const res = await fetch("/api/admin/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, userId }),
			});
			if (res.ok) {
				router.refresh();
			}
		} finally {
			setLoading(false);
		}
	};

	const handleRoleChange = async (newRole: number) => {
		if (newRole === role) return;
		setLoading(true);
		try {
			const res = await fetch("/api/admin/users", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "setRole", userId, role: newRole }),
			});
			if (res.ok) {
				router.refresh();
			}
		} finally {
			setLoading(false);
		}
	};

	// Archived users: view only, no actions
	if (status === UserStatus.Archived) {
		return <span className="text-xs text-muted-foreground">Archived</span>;
	}

	return (
		<div className="flex items-center gap-2">
			{/* Role change dropdown */}
			<select
				value={role}
				onChange={(e) => handleRoleChange(Number(e.target.value))}
				disabled={loading}
				className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
			>
				{ROLE_OPTIONS.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>

			{/* Ban/Unban button */}
			{status === UserStatus.Banned ? (
				<Button
					variant="outline"
					size="sm"
					disabled={loading}
					onClick={() => handleAction("unban")}
				>
					{loading ? "..." : "Unban"}
				</Button>
			) : (
				<Button
					variant="destructive"
					size="sm"
					disabled={loading}
					onClick={() => handleAction("ban")}
				>
					{loading ? "..." : "Ban"}
				</Button>
			)}
		</div>
	);
}
