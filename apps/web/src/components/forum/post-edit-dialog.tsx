"use client";

// components/forum/post-edit-dialog.tsx — Edit post content dialog

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
import { ApiError } from "@/lib/api-client";
import { editMyPost, editPost } from "@/lib/moderation-api";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

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
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = useCallback(
		async (html: string) => {
			const strippedContent = html.replace(/<[^>]*>/g, "").trim();
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
					"sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col",
					"rounded-xl",
				)}
				showCloseButton
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Pencil className="h-5 w-5 text-primary" />
						编辑回复
					</DialogTitle>
					<DialogDescription>修改回复内容</DialogDescription>
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
						initialContent={currentContent}
						onSubmit={handleSubmit}
						placeholder="编辑回复内容..."
						maxLength={10000}
						submitting={submitting}
						canSubmit={!submitting}
					/>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
						取消
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
