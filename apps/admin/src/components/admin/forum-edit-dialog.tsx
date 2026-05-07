"use client";

import type { Forum, ForumType, ForumUpdate } from "@/viewmodels/admin/forums";
import { Button } from "@ellie/ui";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@ellie/ui";
import { Input } from "@ellie/ui";
import { Label } from "@ellie/ui";
import { Select } from "@ellie/ui";
import { useCallback, useEffect, useState } from "react";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forum: Forum | null;
	forums: Forum[]; // For parent selection
	loading?: boolean;
	error?: string | null;
	onSave: (id: number, data: ForumUpdate) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
	{ value: 1, label: "正常" },
	{ value: 0, label: "隐藏" },
];

const TYPE_OPTIONS: { value: ForumType; label: string }[] = [
	{ value: "group", label: "分区" },
	{ value: "forum", label: "版块" },
	{ value: "sub", label: "子版块" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForumEditDialog({
	open,
	onOpenChange,
	forum,
	forums,
	loading = false,
	error,
	onSave,
}: ForumEditDialogProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [icon, setIcon] = useState("");
	const [displayOrder, setDisplayOrder] = useState(0);
	const [status, setStatus] = useState(1);
	const [type, setType] = useState<ForumType>("forum");
	const [parentId, setParentId] = useState(0);

	// Reset form when dialog opens with new forum
	useEffect(() => {
		if (open && forum) {
			setName(forum.name);
			setDescription(forum.description);
			setIcon(forum.icon);
			setDisplayOrder(forum.displayOrder);
			setStatus(forum.status);
			setType(forum.type);
			setParentId(forum.parentId);
		}
	}, [open, forum]);

	// Get valid parent options based on type
	const getValidParents = useCallback(() => {
		if (!forum) return [];

		// Groups can only have parentId = 0
		if (type === "group") return [];

		// Forums can be under groups
		if (type === "forum") {
			return forums.filter((f) => f.type === "group" && f.id !== forum.id);
		}

		// Subs can be under forums
		if (type === "sub") {
			return forums.filter((f) => f.type === "forum" && f.id !== forum.id);
		}

		return [];
	}, [forum, forums, type]);

	// Auto-adjust parentId when type changes
	useEffect(() => {
		if (type === "group") {
			setParentId(0);
		} else {
			const validParents = getValidParents();
			if (validParents.length > 0 && !validParents.find((p) => p.id === parentId)) {
				setParentId(validParents[0].id);
			}
		}
	}, [type, getValidParents, parentId]);

	const handleSave = useCallback(() => {
		if (!name.trim() || loading || !forum) return;
		onSave(forum.id, {
			name: name.trim(),
			description: description.trim(),
			icon: icon.trim(),
			displayOrder,
			status,
			type,
			parentId,
		});
	}, [name, description, icon, displayOrder, status, type, parentId, loading, forum, onSave]);

	const validParents = getValidParents();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>编辑版块</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense />}

				<div className="grid gap-4 py-4">
					{/* Type selector */}
					<div className="grid gap-2">
						<Label htmlFor="edit-type">类型</Label>
						<div className="flex gap-2">
							{TYPE_OPTIONS.map((opt) => (
								<button
									key={opt.value}
									type="button"
									onClick={() => setType(opt.value)}
									className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
										type === opt.value
											? "border-primary bg-primary text-primary-foreground"
											: "border-border bg-background hover:bg-accent"
									}`}
								>
									{opt.label}
								</button>
							))}
						</div>
					</div>

					{/* Parent selector (only for forum/sub) */}
					{type !== "group" && validParents.length > 0 && (
						<div className="grid gap-2">
							<Label htmlFor="edit-parent">上级{type === "forum" ? "分区" : "版块"}</Label>
							<Select
								id="edit-parent"
								value={parentId}
								onChange={(e) => setParentId(Number(e.target.value))}
								options={[
									...(type === "forum" ? [{ value: 0, label: "无上级分区" }] : []),
									...validParents.map((p) => ({ value: p.id, label: p.name })),
								]}
							/>
						</div>
					)}

					{/* Name */}
					<div className="grid gap-2">
						<Label htmlFor="edit-name">名称</Label>
						<Input
							id="edit-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
							placeholder="版块名称"
						/>
					</div>

					{/* Description */}
					<div className="grid gap-2">
						<Label htmlFor="edit-description">描述</Label>
						<textarea
							id="edit-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
							placeholder="版块描述"
							maxLength={500}
						/>
					</div>

					{/* Icon */}
					<div className="grid gap-2">
						<Label htmlFor="edit-icon">图标</Label>
						<Input
							id="edit-icon"
							value={icon}
							onChange={(e) => setIcon(e.target.value)}
							maxLength={100}
							placeholder="图标 URL 或 emoji"
						/>
					</div>

					{/* Order & Status */}
					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-order">排序</Label>
							<Input
								id="edit-order"
								type="number"
								value={displayOrder}
								onChange={(e) => setDisplayOrder(Number(e.target.value))}
								min={0}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="edit-status">状态</Label>
							<Select
								id="edit-status"
								value={status}
								onChange={(e) => setStatus(Number(e.target.value))}
								options={STATUS_OPTIONS}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={!name.trim() || loading}>
						{loading ? "保存中..." : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
