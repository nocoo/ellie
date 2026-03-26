// components/admin/admin-content-actions.tsx — Content delete button
// Ref: 04c §内容审核 — delete thread/post via admin API
//
// Client component: calls /api/admin/content POST endpoint.

"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AdminContentActionsProps {
	type: "thread" | "post";
	id: number;
}

export function AdminContentActions({ type, id }: AdminContentActionsProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleDelete = async () => {
		if (!confirm(`Delete this ${type}?`)) return;
		setLoading(true);
		try {
			const res = await fetch("/api/admin/content", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type, id }),
			});
			if (res.ok) {
				router.refresh();
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button variant="destructive" size="sm" disabled={loading} onClick={handleDelete}>
			{loading ? "..." : "Delete"}
		</Button>
	);
}
