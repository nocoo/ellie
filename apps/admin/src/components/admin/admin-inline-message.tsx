// admin-inline-message.tsx — Lightweight feedback banner for admin pages and dialogs.
//
// A single component handles both the "settings form" page-top banner and the
// in-dialog error/success slot — variant + density controlled by props. We keep
// this purely presentational; state lives in viewmodels/pages.

"use client";

import { Banner } from "@nocoo/basalt/components/banner";
import { AlertCircle, CheckCircle2, Info } from "@nocoo/basalt/icons";

export type AdminInlineMessageVariant = "success" | "error" | "info";

export interface AdminInlineMessageProps {
	variant: AdminInlineMessageVariant;
	text: string;
	/** Tighter padding + icon for use inside a dialog header strip. */
	dense?: boolean;
	className?: string;
}

const VARIANT_ICONS: Record<AdminInlineMessageVariant, typeof CheckCircle2> = {
	success: CheckCircle2,
	error: AlertCircle,
	info: Info,
};

export function AdminInlineMessage({
	variant,
	text,
	dense = false,
	className,
}: AdminInlineMessageProps) {
	const Icon = VARIANT_ICONS[variant];
	return (
		<Banner
			role={variant === "error" ? "alert" : "status"}
			tone={variant === "error" ? "danger" : "neutral"}
			size={dense ? "sm" : "md"}
			icon={<Icon className="h-4 w-4" aria-hidden="true" />}
			description={text}
			className={className}
		/>
	);
}
