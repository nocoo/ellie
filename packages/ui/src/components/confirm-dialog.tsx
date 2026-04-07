"use client";

// components/ui/confirm-dialog.tsx — Reusable confirmation dialog
// Replaces browser's native confirm() with a styled modal

import { Loader2 } from "lucide-react";
import { Button } from "./button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";

interface ConfirmDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when open state changes */
	onOpenChange: (open: boolean) => void;
	/** Dialog title */
	title: string;
	/** Dialog description/message */
	description: string;
	/** Confirm button text */
	confirmText?: string;
	/** Cancel button text */
	cancelText?: string;
	/** Confirm button variant */
	variant?: "default" | "destructive";
	/** Whether action is in progress */
	loading?: boolean;
	/** Callback when confirmed */
	onConfirm: () => void;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmText = "确定",
	cancelText = "取消",
	variant = "default",
	loading = false,
	onConfirm,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
						{cancelText}
					</Button>
					<Button variant={variant} onClick={onConfirm} disabled={loading}>
						{loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
						{confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
