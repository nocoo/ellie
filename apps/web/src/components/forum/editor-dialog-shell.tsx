"use client";

/**
 * EditorDialogShell — shared shell for editor-type dialogs
 * (new-thread, reply, post-edit).
 *
 * Owns: Dialog wrapper, bounded editor layout,
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
					"w-[calc(100vw-1.5rem)] sm:w-[90vw] sm:max-w-4xl",
					"h-[90dvh] max-h-[90dvh] overflow-hidden flex flex-col gap-0",
					"rounded-2xl p-0",
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
		<EditorDialogFrame
			open={open}
			onOpenChange={(next) => {
				if (!submitting) onOpenChange(next);
			}}
		>
			{/* Scroll the form when a keyboard or landscape viewport leaves little height. */}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
				<div className="shrink-0">{header}</div>

				{/* biome-ignore lint/a11y/useSemanticElements: <fieldset> would introduce form/reset semantics we don't want; this is a keyboard-shortcut host, not a form control. */}
				<div
					className="flex min-h-72 flex-1 flex-col px-5 py-4"
					role="group"
					aria-label="编辑器"
					onKeyDown={(e) => {
						if (
							(e.ctrlKey || e.metaKey) &&
							e.key === "Enter" &&
							!e.nativeEvent.isComposing &&
							canSubmit &&
							!submitting
						) {
							e.preventDefault();
							onSubmit();
						}
					}}
				>
					{children}
				</div>
			</div>

			{/* Footer — stacks vertically on narrow screens, row at sm+ */}
			<div className="shrink-0 border-t border-border bg-muted/20 px-5 py-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="hidden text-xs text-muted-foreground sm:block">{footerHint}</p>
					<div className="ml-auto flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={onCancel} disabled={submitting}>
							取消
						</Button>
						<Button
							onClick={onSubmit}
							disabled={!canSubmit || submitting}
							className="gap-2"
							aria-busy={submitting}
						>
							{submitIcon}
							{submitting ? submittingLabel : submitLabel}
						</Button>
					</div>
				</div>
			</div>
		</EditorDialogFrame>
	);
}
