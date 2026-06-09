"use client";

// components/forum/thread-title-edit-dialog.tsx — Edit thread subject (PC + mobile-safe).
//
// Both authors (active + open thread) and moderators converge on this one
// dialog. Permission visibility is gated by `canEditSubject` on the SSR
// page data; the Worker re-enforces via `canEditThreadSubject`.
//
// The entry point is a small Pencil icon button rendered next to the
// thread title `<h1>`, marked `hidden sm:inline-flex` so the affordance
// is PC-only per the reviewer design freeze (msg=a8ee78db).

import { Pencil, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { editThreadSubject } from "@/lib/moderation-api";
import { useForumToast } from "./forum-toast";

const SUBJECT_MAX = 200;

interface ThreadTitleEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	threadId: number;
	currentSubject: string;
}

export function ThreadTitleEditDialog({
	open,
	onOpenChange,
	threadId,
	currentSubject,
}: ThreadTitleEditDialogProps) {
	const router = useRouter();
	const toast = useForumToast();
	const [value, setValue] = useState(currentSubject);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset local input + error when the dialog opens or the source subject
	// changes (e.g. another tab updated the thread and SSR refetched).
	useEffect(() => {
		if (open) {
			setValue(currentSubject);
			setError(null);
		}
	}, [open, currentSubject]);

	const trimmed = value.trim();
	const tooLong = trimmed.length > SUBJECT_MAX;
	const empty = trimmed.length === 0;
	const unchanged = trimmed === currentSubject.trim();
	const canSubmit = !submitting && !empty && !tooLong && !unchanged;

	const handleSubmit = useCallback(async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		setError(null);
		try {
			await editThreadSubject(threadId, trimmed);
			onOpenChange(false);
			toast.success("主题标题已更新");
			router.refresh();
		} catch (err) {
			const message = err instanceof ApiError ? err.message : "保存失败，请稍后重试";
			setError(message);
			toast.error({ title: "保存失败", description: message });
		} finally {
			setSubmitting(false);
		}
	}, [canSubmit, threadId, trimmed, onOpenChange, router, toast]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Pencil className="h-4 w-4 text-primary" />
						编辑主题标题
					</DialogTitle>
					<DialogDescription>标题长度 1–{SUBJECT_MAX} 字符；保存后会立即生效。</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2">
					<Input
						value={value}
						onChange={(e) => setValue(e.target.value)}
						maxLength={SUBJECT_MAX + 50 /* allow soft over-typing; UI guards canSubmit */}
						aria-invalid={tooLong || (value !== "" && empty)}
						placeholder="输入新的主题标题"
						disabled={submitting}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						autoFocus
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span aria-live="polite">
							{tooLong
								? `已超出 ${SUBJECT_MAX} 字符上限`
								: empty
									? "标题不能为空"
									: unchanged
										? "标题未发生变化"
										: ""}
						</span>
						<span>
							{trimmed.length}/{SUBJECT_MAX}
						</span>
					</div>
					{error && (
						<p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
							{error}
						</p>
					)}
				</div>

				<DialogFooter>
					<DialogClose render={<Button variant="outline" disabled={submitting} />}>
						取消
					</DialogClose>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						<Save className="h-4 w-4" />
						{submitting ? "保存中..." : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
