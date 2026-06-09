"use client";

// EmailVerificationDialog — the global dialog the §5.4 dispatch event opens.
//
// Phase 7-2 contract (per reviewer msg 5b4f107f)
// ---------------------------------------------
// 1. Mounted ONCE at the app root via `EmailVerificationDialogMount`. The
//    mount installs exactly one window listener for
//    `EMAIL_NOT_VERIFIED_EVENT` and removes it on unmount.
// 2. CTA navigates to `detail.redirect_to` from the wire body. We do NOT
//    overwrite redirect_to with a hardcoded path — the Worker is the
//    source of truth for where the user should land (it may carry context
//    via querystring or fragment).
// 3. `cta_variant` is normalized via `normalizeCtaVariant` so a missing /
//    unknown wire value falls back to `"primary"` instead of being passed
//    through to Button as `undefined`.
// 4. This component does NOT fetch / read user state. It only renders the
//    dialog and navigates on CTA. The §5.4 event payload is the entire
//    contract; if more state is needed in the future, the dispatcher
//    should carry it, not the dialog.

import type { EmailNotVerifiedCtaVariant } from "@ellie/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	EMAIL_NOT_VERIFIED_EVENT,
	type EmailNotVerifiedEventDetail,
	normalizeCtaVariant,
} from "@/viewmodels/forum/email-not-verified-dispatch";

/**
 * Map the (already-normalized) §5.4 CTA variant to the Button's variant.
 * Today only `"primary"` is shipped; the project's Button uses `"default"`
 * for its primary style. Centralizing the map here means any future
 * variant added to `EmailNotVerifiedCtaVariant` only needs one new branch.
 */
function mapCtaVariantToButton(variant: EmailNotVerifiedCtaVariant): "default" {
	switch (variant) {
		case "primary":
			return "default";
		default: {
			// Exhaustiveness — TS will complain if a new variant is added
			// without a renderer mapping.
			const _exhaustive: never = variant;
			void _exhaustive;
			return "default";
		}
	}
}

/**
 * Props the underlying dialog UI cares about. Split from the mount so the
 * presentation can be tested in isolation without the global event glue.
 */
export interface EmailVerificationDialogViewProps {
	open: boolean;
	detail: EmailNotVerifiedEventDetail | null;
	onOpenChange: (next: boolean) => void;
	onCtaClick: () => void;
}

/**
 * Pure presentation. Renders the §5.4 dialog from `detail`. Returns null
 * when `detail` is unset so the very first render (before any event has
 * fired) doesn't paint stale copy.
 *
 * The CTA button always uses `variant="default"` because the §5.4 spec
 * only ships `"primary"` and our Button doesn't have a literal `"primary"`
 * — `default` is the project's primary visual style. We still take the
 * normalized variant in so a future schema bump (e.g. `"destructive"`)
 * has a single seam to wire through.
 */
export function EmailVerificationDialogView({
	open,
	detail,
	onOpenChange,
	onCtaClick,
}: EmailVerificationDialogViewProps) {
	if (detail == null) return null;
	// Normalize first (so missing/unknown wire variants fall back to
	// "primary"), then map to a Button variant the renderer ships.
	const buttonVariant = mapCtaVariantToButton(normalizeCtaVariant(detail.dialog.cta_variant));
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{detail.dialog.title}</DialogTitle>
					<DialogDescription>{detail.dialog.body}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>稍后再说</DialogClose>
					<Button type="button" variant={buttonVariant} onClick={onCtaClick}>
						{detail.dialog.cta_label}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Global mount. Renders nothing visible by default; opens the dialog when
 * a window-level `EMAIL_NOT_VERIFIED_EVENT` is dispatched (typically by
 * the api-client on a §5.4 wire body, or by a write-button preflight).
 *
 * Lifecycle invariants
 * --------------------
 * - Exactly one listener attached on mount, removed on unmount. We rely
 *   on React's effect cleanup so re-renders never accumulate listeners.
 * - The latest event's `detail` replaces any previous one — if a second
 *   write fires while the dialog is still open, the body simply updates
 *   to the latest copy rather than queueing.
 */
export function EmailVerificationDialogMount() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<EmailNotVerifiedEventDetail | null>(null);

	useEffect(() => {
		// Guard against accidental SSR — the component is "use client" but
		// React 18 strict-mode double-invocation is harmless here, the
		// cleanup removes the listener immediately.
		if (typeof window === "undefined") return;
		const handler = (event: Event) => {
			const ce = event as CustomEvent<EmailNotVerifiedEventDetail>;
			if (ce.detail == null) return;
			setDetail(ce.detail);
			setOpen(true);
		};
		window.addEventListener(EMAIL_NOT_VERIFIED_EVENT, handler);
		return () => {
			window.removeEventListener(EMAIL_NOT_VERIFIED_EVENT, handler);
		};
	}, []);

	const onCtaClick = useCallback(() => {
		// Navigate to the wire-provided redirect_to. We close the dialog
		// optimistically so the user doesn't see it briefly remain open
		// during the route transition.
		const target = detail?.redirect_to;
		setOpen(false);
		if (target) router.push(target);
	}, [detail, router]);

	return (
		<EmailVerificationDialogView
			open={open}
			detail={detail}
			onOpenChange={setOpen}
			onCtaClick={onCtaClick}
		/>
	);
}
