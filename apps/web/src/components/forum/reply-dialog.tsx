"use client";

// Reply dialog with glass-morphism styling (View layer)
// Opens as a modal overlay, contains a simplified PostEditor for replies
// MVVM: This is the View layer. State and logic are in useReplySubmit hook.

import { MessageSquare, Send, XCircle } from "lucide-react";
import { useRef } from "react";
import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useReplySubmit } from "@/viewmodels/forum/use-reply-submit";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";
import { EditorDialogFrame, EditorDialogShell } from "./editor-dialog-shell";

interface ReplyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	threadId: number;
	threadSubject: string;
	/** Quoted content from another post */
	quotedContent?: string;
	quotedAuthor?: string;
	quotedTime?: string;
}

export function ReplyDialog({
	open,
	onOpenChange,
	threadId,
	threadSubject,
	quotedContent,
	quotedAuthor,
	quotedTime,
}: ReplyDialogProps) {
	const { canReply } = useFeatureFlags();
	const editorRef = useRef<{ getHTML: () => string } | null>(null);

	// Use ViewModel hook for reply submission
	const { state, actions } = useReplySubmit({
		threadId,
		onClose: () => onOpenChange(false),
		quotedContent,
		quotedAuthor,
		quotedTime,
	});

	// Reset error when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			actions.clearError();
		}
		onOpenChange(open);
	};

	// Feature disabled state
	if (!canReply) {
		return (
			<EditorDialogFrame open={open} onOpenChange={handleOpenChange}>
				<div className="flex flex-col items-center justify-center h-full gap-4 p-8">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
						<XCircle className="h-8 w-8 text-muted-foreground" />
					</div>
					<div className="text-center">
						<h3 className="text-lg font-semibold text-foreground mb-2">回复功能已暂时关闭</h3>
						<p className="text-sm text-muted-foreground">管理员已暂停回复功能，请稍后再试</p>
					</div>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</div>
			</EditorDialogFrame>
		);
	}

	const handleSubmit = () => {
		const html = editorRef.current?.getHTML() ?? "";
		actions.handleSubmit(html);
	};

	return (
		<EditorDialogShell
			open={open}
			onOpenChange={handleOpenChange}
			header={
				<>
					<DialogHeroHeader
						icon={<MessageSquare className="h-5 w-5 text-primary" />}
						title="回复主题"
						description={`回复：${threadSubject}`}
						onClose={() => handleOpenChange(false)}
					/>

					{state.error && <DialogErrorBanner message={state.error} />}

					{/* Quote preview */}
					{quotedContent && quotedAuthor && (
						<div className="mx-5 mt-4 rounded-lg border border-border/60 bg-muted/30 p-3">
							<p className="text-xs text-muted-foreground mb-1">引用 {quotedAuthor} 的内容：</p>
							<p className="text-sm text-foreground/80 line-clamp-2">
								{quotedContent.replace(/<[^>]*>/g, "")}
							</p>
						</div>
					)}
				</>
			}
			onSubmit={handleSubmit}
			canSubmit={!state.submitting}
			submitting={state.submitting}
			onCancel={() => handleOpenChange(false)}
			footerHint="按 Ctrl+Enter 快速发送"
			submitLabel="发送回复"
			submittingLabel="发送中..."
			submitIcon={<Send className="h-4 w-4" />}
		>
			<PostEditor
				ref={editorRef}
				onSubmit={actions.handleSubmit}
				placeholder="写下你的回复..."
				maxLength={10000}
				submitting={state.submitting}
				canSubmit={!state.submitting}
				hideFooter
			/>
		</EditorDialogShell>
	);
}
