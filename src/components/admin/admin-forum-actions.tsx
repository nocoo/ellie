// components/admin/admin-forum-actions.tsx — Forum management action controls
// Ref: 04c §版块管理 — toggle visibility, edit name/description, adjust display order
//
// Client component: calls /api/admin/forums POST endpoint.

"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AdminForumActionsProps {
	forumId: number;
	status: number;
	name: string;
	description: string;
	displayOrder: number;
}

export function AdminForumActions({
	forumId,
	status,
	name,
	description,
	displayOrder,
}: AdminForumActionsProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [editing, setEditing] = useState(false);
	const [editName, setEditName] = useState(name);
	const [editDesc, setEditDesc] = useState(description);
	const [editOrder, setEditOrder] = useState(String(displayOrder));

	const postUpdate = async (data: Record<string, unknown>) => {
		setLoading(true);
		try {
			const res = await fetch("/api/admin/forums", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ forumId, ...data }),
			});
			if (res.ok) {
				router.refresh();
			}
		} finally {
			setLoading(false);
		}
	};

	const handleToggle = () => {
		postUpdate({ status: status === 1 ? 0 : 1 });
	};

	const handleSave = async () => {
		const updates: Record<string, unknown> = {};
		if (editName !== name) updates.name = editName;
		if (editDesc !== description) updates.description = editDesc;
		const orderNum = Number(editOrder);
		if (!Number.isNaN(orderNum) && orderNum !== displayOrder) updates.displayOrder = orderNum;

		if (Object.keys(updates).length === 0) {
			setEditing(false);
			return;
		}

		await postUpdate(updates);
		setEditing(false);
	};

	if (editing) {
		return (
			<div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
				<div className="flex items-center gap-2">
					<label htmlFor={`forum-name-${forumId}`} className="w-16 text-xs text-muted-foreground">
						Name
					</label>
					<input
						id={`forum-name-${forumId}`}
						type="text"
						value={editName}
						onChange={(e) => setEditName(e.target.value)}
						className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
					/>
				</div>
				<div className="flex items-center gap-2">
					<label htmlFor={`forum-desc-${forumId}`} className="w-16 text-xs text-muted-foreground">
						Desc
					</label>
					<input
						id={`forum-desc-${forumId}`}
						type="text"
						value={editDesc}
						onChange={(e) => setEditDesc(e.target.value)}
						className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
					/>
				</div>
				<div className="flex items-center gap-2">
					<label htmlFor={`forum-order-${forumId}`} className="w-16 text-xs text-muted-foreground">
						Order
					</label>
					<input
						id={`forum-order-${forumId}`}
						type="number"
						value={editOrder}
						onChange={(e) => setEditOrder(e.target.value)}
						className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
					/>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="outline" size="sm" disabled={loading} onClick={() => setEditing(false)}>
						Cancel
					</Button>
					<Button size="sm" disabled={loading} onClick={handleSave}>
						{loading ? "..." : "Save"}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1">
			<Button variant="outline" size="sm" disabled={loading} onClick={() => setEditing(true)}>
				Edit
			</Button>
			<Button variant="outline" size="sm" disabled={loading} onClick={handleToggle}>
				{loading ? "..." : status === 1 ? "Hide" : "Show"}
			</Button>
		</div>
	);
}
