"use client";

import {
	Button,
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from "@nocoo/basalt";
import { useCallback, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import { AdminInlineMessage } from "./admin-inline-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	/** If set, user must type this string to confirm (dangerous action) */
	requireInput?: string;
	/** Placeholder for the confirmation input */
	inputPlaceholder?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "default" | "destructive";
	loading?: boolean;
	error?: string | null;
	onConfirm: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	requireInput,
	inputPlaceholder,
	confirmLabel = "确认",
	cancelLabel = "取消",
	variant = "default",
	loading = false,
	error,
	onConfirm,
}: AdminConfirmDialogProps) {
	const [inputValue, setInputValue] = useState("");

	const canConfirm = requireInput ? inputValue === requireInput : true;

	const handleConfirm = useCallback(() => {
		if (!canConfirm || loading) return;
		onConfirm();
		setInputValue("");
	}, [canConfirm, loading, onConfirm]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (loading) return;
			if (!nextOpen) setInputValue("");
			onOpenChange(nextOpen);
		},
		[loading, onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<AdminDialogContent closeDisabled={loading}>
				<DialogHeader className="pr-8">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense />}

				{requireInput && (
					<div className="py-2">
						<p className="mb-2 text-sm text-basalt-muted-foreground">
							输入{" "}
							<span className="font-mono font-semibold text-basalt-foreground">{requireInput}</span>{" "}
							以确认：
						</p>
						<Input
							aria-label="确认文本"
							disabled={loading}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							placeholder={inputPlaceholder ?? requireInput}
							autoComplete="off"
						/>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
						{cancelLabel}
					</Button>
					<Button variant={variant} onClick={handleConfirm} disabled={!canConfirm || loading}>
						{loading ? "处理中..." : confirmLabel}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
