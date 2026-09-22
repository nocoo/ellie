"use client";

// components/forum/post-edit-dialog.tsx — Edit post content dialog
//
// Uses EditorDialogShell for the shared dialog frame, editor area,
// and footer. Retains its own submit logic, error handling, and
// permission checks.

import { contentToText } from "@ellie/shared/content";
import { Pencil, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { PostEditor, type PostEditorRef } from "@/components/forum/post-editor";
import { ApiError } from "@/lib/api-client";
import { editMyPost, editPost } from "@/lib/moderation-api";
import { useComposerDraft } from "@/viewmodels/forum/use-composer-draft";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";
import { EditorDialogShell } from "./editor-dialog-shell";
import { useForumToast } from "./forum-toast";

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
	const toast = useForumToast();
	const editorRef = useRef<PostEditorRef>(null);
	const [uploading, setUploading] = useState(false);
	const { draft, status, ready, update, clear } = useComposerDraft(`edit:${postId}`, {
		content: currentContent,
		subject: "",
		typeId: null,
	});
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = useCallback(
		async (html: string) => {
			if (submittingRef.current) return;
			const strippedContent = contentToText(html);
			if (strippedContent.length < 2) {
				const message = "内容太短，请输入更多内容";
				setError(message);
				toast.error({ title: "请检查内容", description: message });
				return;
			}

			submittingRef.current = true;
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
					toast.error({ title: "无法保存", description: "没有编辑权限" });
					return;
				}

				clear();
				onOpenChange(false);
				toast.success("回复已保存");
				router.refresh();
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "保存失败，请稍后重试";
				setError(message);
				toast.error({ title: "保存失败", description: message });
			} finally {
				submittingRef.current = false;
				setSubmitting(false);
			}
		},
		[postId, isOwnPost, canModerate, onOpenChange, router, toast, clear],
	);

	const handleShellSubmit = () => {
		editorRef.current?.submit();
	};

	return (
		<EditorDialogShell
			open={open}
			onOpenChange={onOpenChange}
			header={
				<>
					<DialogHeroHeader
						icon={<Pencil className="h-5 w-5 text-primary" />}
						title="编辑回复"
						description="修改回复内容"
						onClose={() => onOpenChange(false)}
						closeDisabled={submitting || uploading}
					/>
					{error && <DialogErrorBanner message={error} />}
				</>
			}
			onSubmit={handleShellSubmit}
			canSubmit={!submitting && ready}
			submitting={submitting}
			busy={submitting || uploading}
			onCancel={() => onOpenChange(false)}
			footerHint="Enter 换行 · Ctrl+Enter 保存（Mac 也可 ⌘+Enter）"
			submitLabel="保存"
			submittingLabel="保存中..."
			submitIcon={<Save className="h-4 w-4" />}
		>
			{ready && (
				<PostEditor
					ref={editorRef}
					initialContent={draft.content}
					onChange={(content) => update({ content })}
					onBusyChange={setUploading}
					draftStatus={status}
					minLength={2}
					onSubmit={handleSubmit}
					placeholder="编辑回复内容..."
					maxLength={10000}
					submitting={submitting}
					canSubmit={!submitting}
					hideFooter
				/>
			)}
		</EditorDialogShell>
	);
}
