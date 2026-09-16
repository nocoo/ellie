"use client";

import {
	Button,
	Dialog,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	SegmentControl,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { FolderPen, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import type { Forum, ForumType, ForumUpdate } from "@/viewmodels/admin/forums";
import { AdminInlineMessage } from "./admin-inline-message";
import { ForumThreadTypesPanel } from "./forum-thread-types-panel";

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
	// Bumped each time the dialog re-opens on a (possibly different) forum,
	// so the embedded ForumThreadTypesPanel can collapse + drop its cached
	// payload instead of flashing the previous forum's data.
	const [threadTypesResetKey, setThreadTypesResetKey] = useState(0);

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
			setThreadTypesResetKey((k) => k + 1);
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
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<AdminDialogContent
				size="xl"
				aria-describedby={undefined}
				closeDisabled={loading}
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="shrink-0 border-b border-basalt-border/50 px-5 py-4 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<FolderPen aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						编辑版块
					</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense className="mx-5 mt-3" />}

				<div className="min-h-0 overflow-y-auto px-5 py-4">
					<fieldset disabled={loading} className="grid min-w-0 gap-4 sm:grid-cols-2">
						{/* Type selector */}
						<SegmentControl
							disabled={loading}
							legend="类型"
							className="sm:col-span-2"
							value={type}
							onValueChange={(value) => setType(value as typeof type)}
							options={TYPE_OPTIONS}
						/>

						{/* Parent selector (only for forum/sub) */}
						{type !== "group" && validParents.length > 0 && (
							<div className="grid gap-2">
								<Label htmlFor="edit-parent">上级{type === "forum" ? "分区" : "版块"}</Label>
								<Select
									disabled={loading}
									value={String(parentId)}
									onValueChange={(value) => setParentId(Number(value))}
								>
									<SelectTrigger id="edit-parent">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[
											...(type === "forum" ? [{ value: 0, label: "无上级分区" }] : []),
											...validParents.map((p) => ({ value: p.id, label: p.name })),
										].map((option) => (
											<SelectItem key={option.value} value={String(option.value)}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* Name */}
						<div className="grid gap-2 sm:col-span-2">
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
						<div className="grid gap-2 sm:col-span-2">
							<Label htmlFor="edit-description">描述</Label>
							<InputArea
								id="edit-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="min-h-20 resize-none"
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
									disabled={loading}
									value={String(status)}
									onValueChange={(value) => setStatus(Number(value))}
								>
									<SelectTrigger id="edit-status">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{STATUS_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={String(option.value)}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* 主题分类 (Phase 3 / #8) — collapsible region. Only renders
					   under non-group forums; a "分区" container doesn't host
					   threads so the picker would be inert. */}
						{type !== "group" && (
							<div className="min-w-0 sm:col-span-2">
								<ForumThreadTypesPanel forumId={forum?.id ?? null} resetKey={threadTypesResetKey} />
							</div>
						)}
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={!name.trim() || loading}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "保存中..." : "保存"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
