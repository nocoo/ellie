// admin-inline-message.tsx — Lightweight feedback banner for admin pages and dialogs.
//
// A single component handles both the "settings form" page-top banner and the
// in-dialog error/success slot — variant + density controlled by props. We keep
// this purely presentational; state lives in viewmodels/pages.

"use client";

import { cn } from "@ellie/ui/utils";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export type AdminInlineMessageVariant = "success" | "error";

export interface AdminInlineMessageProps {
	variant: AdminInlineMessageVariant;
	text: string;
	/** Tighter padding + icon for use inside a dialog header strip. */
	dense?: boolean;
	className?: string;
}

const VARIANT_CLASSES: Record<AdminInlineMessageVariant, string> = {
	success:
		"border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
	error: "border-destructive/50 bg-destructive/10 text-destructive",
};

export function AdminInlineMessage({
	variant,
	text,
	dense = false,
	className,
}: AdminInlineMessageProps) {
	const Icon = variant === "success" ? CheckCircle2 : AlertCircle;
	return (
		<div
			role={variant === "error" ? "alert" : "status"}
			className={cn(
				"flex items-start gap-2 rounded-lg border text-sm",
				dense ? "p-2.5" : "p-3",
				VARIANT_CLASSES[variant],
				className,
			)}
		>
			<Icon className={cn("mt-0.5 shrink-0", dense ? "h-4 w-4" : "h-4 w-4")} aria-hidden="true" />
			<p className="flex-1 leading-snug">{text}</p>
		</div>
	);
}
