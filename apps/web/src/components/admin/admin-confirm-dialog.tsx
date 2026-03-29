"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCallback, useState } from "react";

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
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	variant = "default",
	loading = false,
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
			if (!nextOpen) setInputValue("");
			onOpenChange(nextOpen);
		},
		[onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				{requireInput && (
					<div className="py-2">
						<p className="mb-2 text-sm text-muted-foreground">
							Type <span className="font-mono font-semibold text-foreground">{requireInput}</span>{" "}
							to confirm:
						</p>
						<Input
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
						{loading ? "Processing..." : confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
