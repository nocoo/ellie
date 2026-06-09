"use client";

// New thread dialog with glass-morphism styling (View layer)
// Opens as a modal overlay for creating new forum threads
// MVVM: This is the View layer. State and logic are in useThreadSubmit hook.

import { PenLine, Send, XCircle } from "lucide-react";
import { useRef } from "react";
import { PostEditor } from "@/components/forum/post-editor";
import { ThreadTypePicker } from "@/components/forum/thread-type-picker";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { cn } from "@/lib/utils";
import { type ForumThreadTypesPublic, shouldShowPicker } from "@/viewmodels/forum/thread-types";
import { useThreadSubmit } from "@/viewmodels/forum/use-thread-submit";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";
import { EditorDialogFrame, EditorDialogShell } from "./editor-dialog-shell";

interface NewThreadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forumId: number;
	forumName: string;
	/**
	 * Server-injected 主题分类 payload for this forum. `null` means the
	 * forum has no per-forum config, the loader failed soft, or thread
	 * types are disabled — in any of those cases the picker stays
	 * hidden and submission falls back to the plain (no-typeId) path
	 * (reviewer pin msg 9154cc68: server-injected to all entries).
	 */
	threadTypes?: ForumThreadTypesPublic | null;
}

export function NewThreadDialog({
	open,
	onOpenChange,
	forumId,
	forumName,
	threadTypes = null,
}: NewThreadDialogProps) {
	const { canCreateThread } = useFeatureFlags();
	const editorRef = useRef<{ getHTML: () => string } | null>(null);

	const showPicker = shouldShowPicker(threadTypes);
	const typeIdRequired = !!(showPicker && threadTypes?.required);

	// Use ViewModel hook for thread submission
	const { state, actions, validation } = useThreadSubmit({
		forumId,
		onSuccess: () => onOpenChange(false),
		typeIdRequired,
	});

	// Reset state when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			actions.reset();
		}
		onOpenChange(open);
	};

	// Feature disabled state
	if (!canCreateThread) {
		return (
			<EditorDialogFrame open={open} onOpenChange={handleOpenChange}>
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
						icon={<PenLine className="h-5 w-5 text-primary" />}
						title="发表新帖"
						description={`发布到：${forumName}`}
						onClose={() => handleOpenChange(false)}
					/>

					{state.error && <DialogErrorBanner message={state.error} />}

					{/* 主题分类 picker — only when the host forum has it on. */}
					{showPicker && threadTypes && (
						<ThreadTypePicker
							types={threadTypes.types}
							value={state.typeId}
							onChange={actions.setTypeId}
							required={typeIdRequired}
							error={validation.typeIdError}
							disabled={state.submitting}
						/>
					)}

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
				</>
			}
			onSubmit={handleSubmit}
			canSubmit={validation.canSubmit}
			submitting={state.submitting}
			onCancel={() => handleOpenChange(false)}
			footerHint="按 Ctrl+Enter 快速发布"
			submitLabel="发布主题"
			submittingLabel="发布中..."
			submitIcon={<Send className="h-4 w-4" />}
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
		</EditorDialogShell>
	);
}
