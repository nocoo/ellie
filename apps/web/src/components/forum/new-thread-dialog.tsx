"use client";

// New thread dialog with glass-morphism styling (View layer)
// Opens as a modal overlay for creating new forum threads
// MVVM: This is the View layer. State and logic are in useThreadSubmit hook.

import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { cn } from "@/lib/utils";
import { useThreadSubmit } from "@/viewmodels/forum/use-thread-submit";
import { PenLine, Send, XCircle } from "lucide-react";
import { useRef } from "react";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";

interface NewThreadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forumId: number;
	forumName: string;
}

export function NewThreadDialog({ open, onOpenChange, forumId, forumName }: NewThreadDialogProps) {
	const { canCreateThread } = useFeatureFlags();
	const editorRef = useRef<{ getHTML: () => string } | null>(null);

	// Use ViewModel hook for thread submission
	const { state, actions, validation } = useThreadSubmit({
		forumId,
		onSuccess: () => onOpenChange(false),
	});

	// Reset state when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			actions.reset();
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
				{!canCreateThread ? (
					<div className="flex flex-col items-center justify-center h-full gap-4 p-8">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
							<XCircle className="h-8 w-8 text-muted-foreground" />
						</div>
						<div className="text-center">
							<h3 className="text-lg font-semibold text-foreground mb-2">发帖功能已暂时关闭</h3>
							<p className="text-sm text-muted-foreground">管理员已暂停发帖功能，请稍后再试</p>
						</div>
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							关闭
						</Button>
					</div>
				) : (
					<>
						{/* Header */}
						<DialogHeroHeader
							icon={<PenLine className="h-5 w-5 text-primary" />}
							title="发表新帖"
							description={`发布到：${forumName}`}
							onClose={() => handleOpenChange(false)}
						/>

						{/* Error display */}
						{state.error && <DialogErrorBanner message={state.error} />}

						{/* Subject input */}
						<div className="px-5 pt-4">
							<div className="relative">
								<input
									type="text"
									value={state.subject}
									onChange={(e) => actions.setSubject(e.target.value)}
									placeholder="输入主题标题..."
									disabled={state.submitting}
									maxLength={100}
									className={cn(
										"w-full h-11 rounded-lg border bg-card/50 px-4 text-base font-medium",
										"placeholder:text-muted-foreground/60 outline-none transition-colors",
										"focus:border-primary focus:ring-2 focus:ring-primary/20",
										"disabled:opacity-50 disabled:cursor-not-allowed",
										validation.subjectError
											? "border-destructive focus:border-destructive focus:ring-destructive/20"
											: "border-border/60",
									)}
								/>
								<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
									{state.subject.length}/100
								</span>
							</div>
							{validation.subjectError && (
								<p className="mt-1.5 text-xs text-destructive">{validation.subjectError}</p>
							)}
						</div>

						{/* Editor area — PostEditor is its own bordered card and grows */}
						<div
							className="flex-1 min-h-0 px-5 py-4 flex flex-col"
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && validation.canSubmit) {
									e.preventDefault();
									const html = editorRef.current?.getHTML() ?? "";
									actions.handleSubmit(html);
								}
							}}
						>
							<PostEditor
								ref={editorRef}
								onSubmit={actions.handleSubmit}
								placeholder="写下你的主题内容..."
								maxLength={50000}
								submitting={state.submitting}
								canSubmit={validation.canSubmit}
								hideFooter
							/>
						</div>

						{/* Footer — stacks vertically on narrow screens, row at sm+ */}
						<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
							<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p className="text-xs text-muted-foreground">按 Ctrl+Enter 快速发布</p>
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
										disabled={!validation.canSubmit}
										className="gap-2"
									>
										<Send className="h-4 w-4" />
										{state.submitting ? "发布中..." : "发布主题"}
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
