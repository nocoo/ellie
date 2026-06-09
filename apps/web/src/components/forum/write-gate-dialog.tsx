"use client";

// WriteGateDialog — global dialog for posting restriction feedback.
//
// Mounted once at the app root via `WriteGateDialogMount`. When the
// write-gate preflight blocks a write action, it dispatches a
// WRITE_GATE_EVENT with the restriction reason and code. This dialog
// listens for that event and renders the appropriate message + CTA.

import { Check } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
	codeToCtaLabel,
	codeToRedirect,
	getWriteGateOnboardingSteps,
	WRITE_GATE_EVENT,
	type WriteGateEventDetail,
} from "@/viewmodels/forum/write-gate";

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
	const onboardingSteps = getWriteGateOnboardingSteps(detail.code);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>无法发送内容</DialogTitle>
					<DialogDescription>{detail.reason}</DialogDescription>
				</DialogHeader>
				{onboardingSteps.length > 0 && (
					<ol aria-label="发帖前的引导步骤" className="flex items-start gap-2 px-1 py-2 text-xs">
						{onboardingSteps.map((step, idx) => (
							<li
								key={step.label}
								data-testid={`write-gate-step-${idx + 1}`}
								data-status={step.status}
								className="flex flex-1 flex-col items-center gap-1 text-center"
							>
								<span
									aria-hidden="true"
									className={cn(
										"flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium",
										step.status === "done" && "border-green-600 bg-green-600 text-white",
										step.status === "current" &&
											"border-primary bg-primary text-primary-foreground",
										step.status === "pending" &&
											"border-muted-foreground/40 bg-muted text-muted-foreground",
									)}
								>
									{step.status === "done" ? <Check className="h-3.5 w-3.5" /> : idx + 1}
								</span>
								<span
									className={cn(
										"leading-tight",
										step.status === "done" && "text-green-600",
										step.status === "current" && "font-medium text-foreground",
										step.status === "pending" && "text-muted-foreground",
									)}
								>
									{step.label}
								</span>
							</li>
						))}
					</ol>
				)}
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
