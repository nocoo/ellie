"use client";

// New thread dialog with glass-morphism styling
// Opens as a modal overlay for creating new forum threads

import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

interface NewThreadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forumId: number;
	forumName: string;
}

const ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录后再发帖",
	FORUM_CLOSED: "该版块已关闭，无法发帖",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
};

interface CreateThreadResponse {
	id: number;
}

export function NewThreadDialog({
	open,
	onOpenChange,
	forumId,
	forumName,
}: NewThreadDialogProps) {
	const router = useRouter();
	const [subject, setSubject] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Validation
	const subjectError = !subject.trim()
		? null // Don't show error when empty (initial state)
		: subject.trim().length < 4
			? "标题至少需要4个字符"
			: subject.trim().length > 100
				? "标题不能超过100个字符"
				: null;

	const canSubmit = subject.trim().length >= 4 && subject.trim().length <= 100 && !submitting;

	const handleSubmit = useCallback(
		async (html: string) => {
			// Validate subject
			if (subject.trim().length < 4) {
				setError("请输入标题（至少4个字符）");
				return;
			}

			// Validate content
			const strippedContent = html.replace(/<[^>]*>/g, "").trim();
			if (strippedContent.length < 10) {
				setError("内容太短，请输入更多内容（至少10个字符）");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				const response = await apiClient.post<CreateThreadResponse>("/api/v1/threads", {
					forumId,
					subject: subject.trim(),
					content: html,
				});

				onOpenChange(false);
				setSubject("");

				// Navigate to the new thread
				if (response.data?.id) {
					router.push(`/threads/${response.data.id}`);
				} else {
					router.refresh();
				}
			} catch (err) {
				const code = err instanceof ApiError ? err.code : "UNKNOWN";
				const message = ERROR_MESSAGES[code] ?? "发帖失败，请稍后重试";
				setError(message);
			} finally {
				setSubmitting(false);
			}
		},
		[forumId, subject, onOpenChange, router],
	);

	// Reset state when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setSubject("");
			setError(null);
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className={cn(
					"glass-panel",
					"sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col",
					"rounded-xl",
				)}
				showCloseButton
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<PenLine className="h-5 w-5 text-primary" />
						发表新帖
					</DialogTitle>
					<DialogDescription>发布到：{forumName}</DialogDescription>
				</DialogHeader>

				{/* Error display */}
				{error && (
					<div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Editor with subject */}
				<div className="flex-1 overflow-y-auto min-h-0">
					<PostEditor
						subject={subject}
						onSubjectChange={setSubject}
						onSubmit={handleSubmit}
						placeholder="写下你的帖子内容..."
						maxLength={50000}
						submitting={submitting}
						canSubmit={canSubmit}
					/>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					{/* Submit is handled by PostEditor's internal button */}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
