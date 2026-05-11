"use client";

// WriteGateDialog — global dialog for posting restriction feedback.
//
// Mounted once at the app root via `WriteGateDialogMount`. When the
// write-gate preflight blocks a write action, it dispatches a
// WRITE_GATE_EVENT with the restriction reason and code. This dialog
// listens for that event and renders the appropriate message + CTA.

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
	WRITE_GATE_EVENT,
	type WriteGateEventDetail,
	codeToCtaLabel,
	codeToRedirect,
} from "@/viewmodels/forum/write-gate";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * Global mount. Renders nothing visible by default; opens the dialog when
 * a WRITE_GATE_EVENT is dispatched by the write-gate preflight.
 */
export function WriteGateDialogMount() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<WriteGateEventDetail | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const handler = (event: Event) => {
			const ce = event as CustomEvent<WriteGateEventDetail>;
			if (ce.detail == null) return;
			setDetail(ce.detail);
			setOpen(true);
		};
		window.addEventListener(WRITE_GATE_EVENT, handler);
		return () => {
			window.removeEventListener(WRITE_GATE_EVENT, handler);
		};
	}, []);

	const onCtaClick = useCallback(() => {
		if (!detail) return;
		const redirect = codeToRedirect(detail.code);
		setOpen(false);
		if (redirect) router.push(redirect);
	}, [detail, router]);

	if (detail == null) return null;

	const ctaLabel = codeToCtaLabel(detail.code);
	const redirectTo = codeToRedirect(detail.code);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>无法发送内容</DialogTitle>
					<DialogDescription>{detail.reason}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>知道了</DialogClose>
					{ctaLabel && redirectTo && (
						<Button type="button" variant="default" onClick={onCtaClick}>
							{ctaLabel}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
