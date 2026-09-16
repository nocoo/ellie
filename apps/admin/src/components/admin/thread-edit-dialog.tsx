"use client";

import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from "@nocoo/basalt";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Thread, ThreadUpdate } from "@/viewmodels/admin/threads";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	thread: Thread | null;
	loading?: boolean;
	error?: string | null;
	onSave: (id: number, data: ThreadUpdate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadEditDialog({
	open,
	onOpenChange,
	thread,
	loading = false,
	error,
	onSave,
}: ThreadEditDialogProps) {
	const [subject, setSubject] = useState("");
	const [sticky, setSticky] = useState(0);
	const [digest, setDigest] = useState(0);
	const [closed, setClosed] = useState(0);
	const [highlight, setHighlight] = useState(0);

	useEffect(() => {
		if (thread) {
			setSubject(thread.subject);
			setSticky(thread.sticky);
			setDigest(thread.digest);
			setClosed(thread.closed);
			setHighlight(thread.highlight);
		}
	}, [thread]);

	const handleSave = useCallback(() => {
		if (!thread || loading) return;
		onSave(thread.id, { subject, sticky, digest, closed, highlight });
	}, [thread, loading, onSave, subject, sticky, digest, closed, highlight]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg" className="grid gap-4" aria-describedby={undefined}>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon"
						className="absolute right-3 top-3 h-8 w-8"
						aria-label="关闭弹窗"
					>
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>

				<DialogHeader className="pr-8">
					<DialogTitle>编辑主题</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense />}

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="edit-subject">标题</Label>
						<Input
							id="edit-subject"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							maxLength={200}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-sticky">置顶</Label>
							<Select value={String(sticky)} onValueChange={(value) => setSticky(Number(value))}>
								<SelectTrigger id="edit-sticky">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: 0, label: "无" },
										{ value: 1, label: "版块置顶" },
										{ value: 2, label: "全局置顶" },
										{ value: 3, label: "分类置顶" },
									].map((option) => (
										<SelectItem key={option.value} value={String(option.value)}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="edit-digest">精华</Label>
							<Select value={String(digest)} onValueChange={(value) => setDigest(Number(value))}>
								<SelectTrigger id="edit-digest">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: 0, label: "无" },
										{ value: 1, label: "精华 I" },
										{ value: 2, label: "精华 II" },
										{ value: 3, label: "精华 III" },
									].map((option) => (
										<SelectItem key={option.value} value={String(option.value)}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-closed">已锁定</Label>
							<Select value={String(closed)} onValueChange={(value) => setClosed(Number(value))}>
								<SelectTrigger id="edit-closed">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: 0, label: "开放" },
										{ value: 1, label: "已锁定" },
									].map((option) => (
										<SelectItem key={option.value} value={String(option.value)}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="edit-highlight">高亮</Label>
							<Input
								id="edit-highlight"
								type="number"
								value={highlight}
								onChange={(e) => setHighlight(Number(e.target.value))}
								min={0}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						{loading ? "保存中..." : "保存更改"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
