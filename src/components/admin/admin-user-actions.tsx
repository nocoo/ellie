// components/admin/admin-user-actions.tsx — User action buttons
// Ref: 04c §用户管理 — ban/unban actions via admin API
//
// Client component: calls /api/admin/users POST endpoint.

"use client";

import { Button } from "@/components/ui/button";
import { UserStatus } from "@/models/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AdminUserActionsProps {
	userId: number;
	status: number;
}

export function AdminUserActions({ userId, status }: AdminUserActionsProps) {
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

	return status === UserStatus.Banned ? (
		<Button variant="outline" size="sm" disabled={loading} onClick={() => handleAction("unban")}>
			{loading ? "..." : "Unban"}
		</Button>
	) : (
		<Button variant="destructive" size="sm" disabled={loading} onClick={() => handleAction("ban")}>
			{loading ? "..." : "Ban"}
		</Button>
	);
}
