// components/forum/dialog-error-banner.tsx — Inline error banner used by
// modern hero-style dialogs (post-edit, new-thread, reply, profile-edit).
//
// Extracted to keep the destructive surface tokens and AlertCircle layout
// consistent across all four dialogs. Outer margins (mx-5 mt-4) match the
// hero header padding so the banner aligns with the title row underneath.
//
// NOTE: intentionally does NOT carry role="alert" — the live announcement
// is handled by the surrounding toast, and stamping role="alert" on the
// inline copy would make screen readers double-announce and break tests
// that rely on a single ARIA alert per dialog.

import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

interface DialogErrorBannerProps {
	message: string;
	className?: string;
}

export function DialogErrorBanner({ message, className }: DialogErrorBannerProps) {
	return (
		<div
			className={cn(
				"mx-5 mt-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3",
				className,
			)}
		>
			<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
			<p className="text-sm text-destructive">{message}</p>
		</div>
	);
}
