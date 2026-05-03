"use client";

// components/forum/post-edit-dialog.tsx — Edit post content dialog
//
// B4: unified to the same shell as `new-thread-dialog.tsx` /
// `reply-dialog.tsx` — same `max-w-[1200px]` cap, same `max-h-[90vh]`
// content-driven height, same header/footer hierarchy. The PostEditor
// `hideFooter` flag is on so the dialog footer is the single source of
// truth for submit/cancel.

import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { editMyPost, editPost } from "@/lib/moderation-api";
import { stripHtmlTags } from "@/lib/text";
import { cn } from "@/lib/utils";
import { AlertCircle, Pencil, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

interface PostEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	postId: number;
	currentContent: string;
	/** Is this the current user's own post? */
	isOwnPost: boolean;
	/** Can user moderate (edit any post)? */
	canModerate: boolean;
}

export function PostEditDialog({
	open,
	onOpenChange,
	postId,
	currentContent,
	isOwnPost,
	canModerate,
}: PostEditDialogProps) {
	const router = useRouter();
	const editorRef = useRef<{ getHTML: () => string } | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = useCallback(
		async (html: string) => {
			const strippedContent = stripHtmlTags(html).trim();
			if (strippedContent.length < 2) {
				setError("内容太短，请输入更多内容");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				// Use user self-service API if own post, otherwise moderation API
				if (isOwnPost) {
					await editMyPost(postId, html);
				} else if (canModerate) {
					await editPost(postId, html);
				} else {
					setError("没有编辑权限");
					return;
				}

				onOpenChange(false);
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "保存失败，请稍后重试";
				setError(message);
			} finally {
				setSubmitting(false);
			}
		},
		[postId, isOwnPost, canModerate, onOpenChange, router],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"glass-panel",
					"w-[calc(100vw-2rem)] sm:w-[80vw] sm:max-w-[80vw]",
					"max-h-[90vh] sm:h-[85vh] overflow-hidden flex flex-col",
					"rounded-xl p-0",
				)}
				showCloseButton={false}
			>
				{/* Header */}
				<DialogHeader className="px-5 pt-5 pb-4 border-b border-border/50">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
							<Pencil className="h-5 w-5 text-primary" />
						</div>
						<div>
							<DialogTitle className="text-lg">编辑回复</DialogTitle>
							<DialogDescription className="text-xs mt-0.5">修改回复内容</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				{/* Error display */}
				{error && (
					<div className="mx-5 mt-4 flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
						<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Editor area */}
				<div
					className="flex-1 min-h-0 px-5 py-4 flex flex-col"
					onKeyDown={(e) => {
						if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !submitting) {
							e.preventDefault();
							const html = editorRef.current?.getHTML() ?? "";
							handleSubmit(html);
						}
					}}
				>
					<PostEditor
						ref={editorRef}
						initialContent={currentContent}
						onSubmit={handleSubmit}
						placeholder="编辑回复内容..."
						maxLength={10000}
						submitting={submitting}
						canSubmit={!submitting}
						hideFooter
					/>
				</div>

				{/* Footer — stacks vertically on narrow screens, row at sm+ */}
				<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
					<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-xs text-muted-foreground">按 Ctrl+Enter 保存</p>
						<div className="flex items-center justify-end gap-2">
							<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
								取消
							</Button>
							<Button
								onClick={() => {
									const html = editorRef.current?.getHTML() ?? "";
									handleSubmit(html);
								}}
								disabled={submitting}
								className="gap-2"
							>
								<Save className="h-4 w-4" />
								{submitting ? "保存中..." : "保存"}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
