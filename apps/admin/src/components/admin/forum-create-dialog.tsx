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
import { FolderPlus, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import type { Forum, ForumCreate, ForumType } from "@/viewmodels/admin/forums";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forums: Forum[]; // For parent selection
	loading?: boolean;
	error?: string | null;
	onSave: (data: ForumCreate) => void;
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

export function ForumCreateDialog({
	open,
	onOpenChange,
	forums,
	loading = false,
	error,
	onSave,
}: ForumCreateDialogProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [icon, setIcon] = useState("");
	const [displayOrder, setDisplayOrder] = useState(0);
	const [status, setStatus] = useState(1);
	const [type, setType] = useState<ForumType>("forum");
	const [parentId, setParentId] = useState(0);

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			setName("");
			setDescription("");
			setIcon("");
			setDisplayOrder(0);
			setStatus(1);
			setType("forum");
			setParentId(0);
		}
	}, [open]);

	// Get valid parent options based on type
	const getValidParents = useCallback(() => {
		// Groups can only have parentId = 0
		if (type === "group") return [];

		// Forums can be under groups
		if (type === "forum") {
			return forums.filter((f) => f.type === "group");
		}

		// Subs can be under forums
		if (type === "sub") {
			return forums.filter((f) => f.type === "forum");
		}

		return [];
	}, [forums, type]);

	// Auto-adjust parentId when type changes
	useEffect(() => {
		if (type === "group") {
			setParentId(0);
		} else {
			const validParents = getValidParents();
			if (validParents.length > 0) {
				setParentId(validParents[0].id);
			} else {
				setParentId(0);
			}
		}
	}, [type, getValidParents]);

	const handleSave = useCallback(() => {
		if (!name.trim() || loading) return;
		onSave({
			name: name.trim(),
			description: description.trim(),
			icon: icon.trim(),
			displayOrder,
			status,
			type,
			parentId,
		});
	}, [name, description, icon, displayOrder, status, type, parentId, loading, onSave]);

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
						<FolderPlus aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						创建版块
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
								<Label htmlFor="create-parent">上级{type === "forum" ? "分区" : "版块"}</Label>
								<Select
									disabled={loading}
									value={String(parentId)}
									onValueChange={(value) => setParentId(Number(value))}
								>
									<SelectTrigger id="create-parent">
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
							<Label htmlFor="create-name">名称</Label>
							<Input
								id="create-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={100}
								placeholder="版块名称"
							/>
						</div>

						{/* Description */}
						<div className="grid gap-2 sm:col-span-2">
							<Label htmlFor="create-description">描述</Label>
							<InputArea
								id="create-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="min-h-20 resize-none"
								placeholder="版块描述"
								maxLength={500}
							/>
						</div>

						{/* Icon */}
						<div className="grid gap-2">
							<Label htmlFor="create-icon">图标</Label>
							<Input
								id="create-icon"
								value={icon}
								onChange={(e) => setIcon(e.target.value)}
								maxLength={100}
								placeholder="图标 URL 或 emoji"
							/>
						</div>

						{/* Order & Status */}
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="create-order">排序</Label>
								<Input
									id="create-order"
									type="number"
									value={displayOrder}
									onChange={(e) => setDisplayOrder(Number(e.target.value))}
									min={0}
								/>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="create-status">状态</Label>
								<Select
									disabled={loading}
									value={String(status)}
									onValueChange={(value) => setStatus(Number(value))}
								>
									<SelectTrigger id="create-status">
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
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={!name.trim() || loading}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "创建中..." : "创建版块"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
