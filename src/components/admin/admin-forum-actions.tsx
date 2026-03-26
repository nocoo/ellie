// components/admin/admin-forum-actions.tsx — Forum visibility toggle
// Ref: 04c §版块管理 — toggle visibility via admin API
//
// Client component: calls /api/admin/forums POST endpoint.

"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AdminForumActionsProps {
	forumId: number;
	status: number;
}

export function AdminForumActions({ forumId, status }: AdminForumActionsProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleToggle = async () => {
		setLoading(true);
		try {
			const newStatus = status === 1 ? 0 : 1;
			const res = await fetch("/api/admin/forums", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ forumId, status: newStatus }),
			});
			if (res.ok) {
				router.refresh();
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button variant="outline" size="sm" disabled={loading} onClick={handleToggle}>
			{loading ? "..." : status === 1 ? "Hide" : "Show"}
		</Button>
	);
}
