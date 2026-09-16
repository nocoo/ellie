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
import { ListFilter, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import type {
	CensorWord,
	CensorWordCreate,
	CensorWordUpdate,
} from "@/viewmodels/admin/censor-words";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CensorWordCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When non-null the dialog is in "edit" mode. */
	censorWord: CensorWord | null;
	loading?: boolean;
	error?: string | null;
	onSave: (data: CensorWordCreate) => void;
	onUpdate: (id: number, data: CensorWordUpdate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CensorWordCreateDialog({
	open,
	onOpenChange,
	censorWord,
	loading = false,
	error,
	onSave,
	onUpdate,
}: CensorWordCreateDialogProps) {
	const [find, setFind] = useState("");
	const [replacement, setReplacement] = useState("**");
	const [action, setAction] = useState<"ban" | "replace">("replace");

	const isEdit = censorWord !== null;

	useEffect(() => {
		if (!open) return;
		if (censorWord) {
			setFind(censorWord.find);
			setReplacement(censorWord.replacement);
			setAction(censorWord.action);
		} else {
			setFind("");
			setReplacement("**");
			setAction("replace");
		}
	}, [open, censorWord]);

	const handleSave = useCallback(() => {
		if (loading || !find.trim()) return;
		if (isEdit && censorWord) {
			onUpdate(censorWord.id, {
				find: find.trim(),
				replacement,
				action,
			});
		} else {
			onSave({
				find: find.trim(),
				replacement,
				action,
			});
		}
	}, [loading, find, replacement, action, isEdit, censorWord, onSave, onUpdate]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (loading) return;
			if (!nextOpen) {
				setFind("");
				setReplacement("**");
				setAction("replace");
			}
			onOpenChange(nextOpen);
		},
		[loading, onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<AdminDialogContent
				size="lg"
				aria-describedby={undefined}
				closeDisabled={loading}
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="shrink-0 border-b border-basalt-border/50 px-5 py-4 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<ListFilter aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						{isEdit ? "编辑敏感词" : "添加敏感词"}
					</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense className="mx-5 mt-3" />}
				<div className="min-h-0 overflow-y-auto px-5 py-4">
					<fieldset disabled={loading} className="grid min-w-0 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="cw-find">词语 / 正则</Label>
							<Input
								id="cw-find"
								value={find}
								onChange={(e) => setFind(e.target.value)}
								placeholder="输入要过滤的词语"
								maxLength={200}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="cw-action">动作</Label>
							<Select
								disabled={loading}
								value={String(action)}
								onValueChange={(value) => setAction(value as "ban" | "replace")}
							>
								<SelectTrigger id="cw-action">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: "replace", label: "替换" },
										{ value: "ban", label: "禁止发布" },
									].map((option) => (
										<SelectItem key={option.value} value={String(option.value)}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-basalt-muted-foreground">
								替换：将词语替换为指定内容。禁止发布：直接拦截帖子。
							</p>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="cw-replacement">替换内容</Label>
							<Input
								id="cw-replacement"
								value={replacement}
								onChange={(e) => setReplacement(e.target.value)}
								placeholder="留空以删除匹配内容"
								maxLength={200}
								disabled={loading || action === "ban"}
							/>
							<p className="text-xs text-basalt-muted-foreground">
								{action === "ban"
									? "动作为“禁止发布”时不适用。"
									: "默认替换为 **；主动留空会删除匹配内容。"}
							</p>
						</div>
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading || !find.trim()}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "保存中..." : isEdit ? "保存更改" : "添加敏感词"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
