"use client";

// Reply dialog with glass-morphism styling (View layer)
// Opens as a modal overlay, contains a simplified PostEditor for replies
// MVVM: This is the View layer. State and logic are in useReplySubmit hook.

import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { cn } from "@/lib/utils";
import { useReplySubmit } from "@/viewmodels/forum/use-reply-submit";
import { MessageSquare, Send, XCircle } from "lucide-react";
import { useRef } from "react";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";

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

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className={cn(
					"glass-panel",
					"w-[calc(100vw-2rem)] sm:w-[80vw] sm:max-w-[80vw]",
					"max-h-[90vh] sm:h-[85vh] overflow-hidden flex flex-col",
					"rounded-xl p-0",
				)}
				showCloseButton={false}
			>
				{/* Feature disabled state */}
				{!canReply ? (
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
				) : (
					<>
						{/* Header */}
						<DialogHeroHeader
							icon={<MessageSquare className="h-5 w-5 text-primary" />}
							title="回复主题"
							description={`回复：${threadSubject}`}
							onClose={() => handleOpenChange(false)}
						/>

						{/* Error display */}
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

						{/* Editor area — PostEditor is its own bordered card and grows */}
						<div
							className="flex-1 min-h-0 px-5 py-4 flex flex-col"
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !state.submitting) {
									e.preventDefault();
									const html = editorRef.current?.getHTML() ?? "";
									actions.handleSubmit(html);
								}
							}}
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
						</div>

						{/* Footer — stacks vertically on narrow screens, row at sm+ */}
						<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
							<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p className="text-xs text-muted-foreground">按 Ctrl+Enter 快速发送</p>
								<div className="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										onClick={() => handleOpenChange(false)}
										disabled={state.submitting}
									>
										取消
									</Button>
									<Button
										onClick={() => {
											const html = editorRef.current?.getHTML() ?? "";
											actions.handleSubmit(html);
										}}
										disabled={state.submitting}
										className="gap-2"
									>
										<Send className="h-4 w-4" />
										{state.submitting ? "发送中..." : "发送回复"}
									</Button>
								</div>
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
