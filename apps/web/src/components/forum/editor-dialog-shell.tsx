"use client";

/**
 * EditorDialogShell — shared shell for editor-type dialogs
 * (new-thread, reply, post-edit).
 *
 * Owns: Dialog wrapper, DialogContent glass-panel styling,
 * showCloseButton={false}, editor area with flex-1/min-h-0 layout
 * and Ctrl/Cmd+Enter submit shortcut, footer bar with hint text
 * and cancel/submit buttons.
 *
 * Callers provide: header content (hero header, error banner,
 * subject input, quote preview), PostEditor children, submit
 * handler, button labels, and disabled/submitting state.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// EditorDialogFrame — thin wrapper for Dialog + DialogContent styling.
// Used directly by callers that need the dialog frame without the editor
// area and footer (e.g. feature-disabled states).
// ---------------------------------------------------------------------------

export function EditorDialogFrame({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
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
				{children}
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// EditorDialogShell — full editor shell: frame + editor area + footer.
// ---------------------------------------------------------------------------

interface EditorDialogShellProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Content above the editor: hero header, error banner, subject input, quote preview, etc. */
	header: ReactNode;
	/** The PostEditor instance */
	children: ReactNode;
	/** Handler invoked by submit button and Ctrl+Enter shortcut */
	onSubmit: () => void;
	/** Whether submission is allowed (enables button + Ctrl+Enter) */
	canSubmit: boolean;
	/** Whether a submission is in progress (disables cancel button) */
	submitting: boolean;
	/** Cancel button handler */
	onCancel: () => void;
	/** Footer hint text (e.g. "按 Ctrl+Enter 快速发布") */
	footerHint: string;
	/** Submit button label */
	submitLabel: string;
	/** Submit button label during submission */
	submittingLabel: string;
	/** Submit button icon */
	submitIcon: ReactNode;
}

export function EditorDialogShell({
	open,
	onOpenChange,
	header,
	children,
	onSubmit,
	canSubmit,
	submitting,
	onCancel,
	footerHint,
	submitLabel,
	submittingLabel,
	submitIcon,
}: EditorDialogShellProps) {
	return (
		<EditorDialogFrame open={open} onOpenChange={onOpenChange}>
			{header}

			{/* Editor area — flex-1 to fill remaining space, Ctrl+Enter shortcut */}
			{/* biome-ignore lint/a11y/useSemanticElements: <fieldset> would introduce form/reset semantics we don't want; this is a keyboard-shortcut host, not a form control. */}
			<div
				className="flex-1 min-h-0 px-5 py-4 flex flex-col"
				role="group"
				aria-label="编辑器"
				onKeyDown={(e) => {
					if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSubmit) {
						e.preventDefault();
						onSubmit();
					}
				}}
			>
				{children}
			</div>

			{/* Footer — stacks vertically on narrow screens, row at sm+ */}
			<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
				<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-xs text-muted-foreground">{footerHint}</p>
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={onCancel} disabled={submitting}>
							取消
						</Button>
						<Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
							{submitIcon}
							{submitting ? submittingLabel : submitLabel}
						</Button>
					</div>
				</div>
			</div>
		</EditorDialogFrame>
	);
}
