"use client";

import {
	Button,
	Dialog,
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
import { Files, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
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
		if (open && thread) {
			setSubject(thread.subject);
			setSticky(thread.sticky);
			setDigest(thread.digest);
			setClosed(thread.closed);
			setHighlight(thread.highlight);
		}
	}, [open, thread]);

	const handleSave = useCallback(() => {
		if (!thread || loading) return;
		onSave(thread.id, { subject, sticky, digest, closed, highlight });
	}, [thread, loading, onSave, subject, sticky, digest, closed, highlight]);

	return (
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<AdminDialogContent
				size="lg"
				aria-describedby={undefined}
				closeDisabled={loading}
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="shrink-0 border-b border-basalt-border/50 px-5 py-4 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<Files aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						编辑主题
					</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense className="mx-5 mt-3" />}

				<div className="min-h-0 overflow-y-auto px-5 py-4">
					<fieldset disabled={loading} className="grid min-w-0 gap-4">
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
								<Select
									disabled={loading}
									value={String(sticky)}
									onValueChange={(value) => setSticky(Number(value))}
								>
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
								<Select
									disabled={loading}
									value={String(digest)}
									onValueChange={(value) => setDigest(Number(value))}
								>
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
								<Select
									disabled={loading}
									value={String(closed)}
									onValueChange={(value) => setClosed(Number(value))}
								>
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
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "保存中..." : "保存更改"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
