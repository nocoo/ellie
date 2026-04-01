"use client";

// Reply dialog with glass-morphism styling
// Opens as a modal overlay, contains a simplified PostEditor for replies

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
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

interface ReplyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	threadId: number;
	threadSubject: string;
	/** Quoted content from another post */
	quotedContent?: string;
	quotedAuthor?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录后再回复",
	THREAD_CLOSED: "该主题已关闭，无法回复",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
};

export function ReplyDialog({
	open,
	onOpenChange,
	threadId,
	threadSubject,
	quotedContent,
	quotedAuthor,
}: ReplyDialogProps) {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Build initial content with quote if provided
	const initialContent =
		quotedContent && quotedAuthor
			? `<blockquote><p><strong>${quotedAuthor}</strong> 说：</p>${quotedContent}</blockquote><p></p>`
			: "";

	const handleSubmit = useCallback(
		async (html: string) => {
			// Basic validation
			const strippedContent = html.replace(/<[^>]*>/g, "").trim();
			if (strippedContent.length < 2) {
				setError("内容太短，请输入更多内容");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				await apiClient.post("/api/v1/posts", {
					threadId,
					content: html,
				});

				onOpenChange(false);
				router.refresh();
			} catch (err) {
				const code = err instanceof ApiError ? err.code : "UNKNOWN";
				const message = ERROR_MESSAGES[code] ?? "回复失败，请稍后重试";
				setError(message);
			} finally {
				setSubmitting(false);
			}
		},
		[threadId, onOpenChange, router],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
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
						<MessageSquare className="h-5 w-5 text-primary" />
						回复帖子
					</DialogTitle>
					<DialogDescription className="truncate">回复：{threadSubject}</DialogDescription>
				</DialogHeader>

				{/* Error display */}
				{error && (
					<div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Editor */}
				<div className="flex-1 overflow-y-auto min-h-0">
					<PostEditor
						initialContent={initialContent}
						onSubmit={handleSubmit}
						placeholder="写下你的回复..."
						maxLength={10000}
						submitting={submitting}
						canSubmit={!submitting}
					/>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					{/* Submit is handled by PostEditor's internal button */}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
