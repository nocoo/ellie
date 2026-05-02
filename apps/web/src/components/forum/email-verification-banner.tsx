// EmailVerificationBanner — passive server-rendered prompt for unverified
// users. Mounted by the forum layout above page content. See
// `viewmodels/forum/email-verification-banner.ts` for the render decision.
//
// Server component (no "use client"): the gating is server-side and the
// banner is just a static notice + link, so we keep it out of the client
// bundle. The §5.4 dialog and the backend 403 fallback are the
// interactive paths — this component does NOT replace them.

import { buttonVariants } from "@/components/ui/button-variants";
import type { SelfForumUser } from "@/lib/forum-self";
import { pickEmailVerificationBannerVm } from "@/viewmodels/forum/email-verification-banner";
import Link from "next/link";

export interface EmailVerificationBannerProps {
	self: SelfForumUser | null;
}

export function EmailVerificationBanner({ self }: EmailVerificationBannerProps) {
	const vm = pickEmailVerificationBannerVm(self);
	if (!vm.visible) return null;
	return (
		<output
			aria-live="polite"
			className="mb-3 flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-amber-900 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100"
		>
			<div className="flex flex-col gap-0.5">
				<span className="font-medium">{vm.title}</span>
				<span className="text-amber-900/80 dark:text-amber-100/80">{vm.body}</span>
			</div>
			<Link
				href={vm.ctaHref}
				className={buttonVariants({
					variant: "default",
					size: "sm",
					className: "self-start sm:self-auto",
				})}
			>
				{vm.ctaLabel}
			</Link>
		</output>
	);
}
