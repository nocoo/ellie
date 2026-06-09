// Route: /verify-email — deep-link entry into the email-verification flow.
//
// Phase 6D scope (per reviewer msg a36bb068)
// ------------------------------------------
// `/verify-email` is the secondary entry point. The primary entry is
// `/me#email`; this route exists so external links (notification emails,
// older bookmarks, the Phase 7 dialog's secondary CTA) keep working
// without bouncing through the user-page chrome.
//
// Reuse contract
// --------------
// - Same loader as /me: `getSelfForumUser()`. No new helper, no new
//   proxy.
// - Same component: `EmailVerificationCard`. No copy of the form
//   wiring.
// - Same auth gate: null self-load → `/login?redirect=/verify-email`
//   so the user lands back here after sign-in.
// - Same fail-closed Cap config: env key passed in as a prop;
//   missing key surfaces inside the card as a config error.
//
// What's intentionally different from /me
// ---------------------------------------
// - No `<section id="email">` wrapper / no `scroll-mt-20` — there is
//   no other content on this page to scroll past, so the anchor is
//   redundant. Breadcrumbs are simpler ("首页 → 邮箱验证") for the
//   same reason.
// - Already-verified users still see the verified card (the card
//   handles that mode) — we deliberately do NOT redirect them away,
//   so a deep link is always informational rather than a surprise
//   redirect.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmailVerificationCard } from "@/components/forum/email-verification-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getSelfForumUser, toEmailVerificationUserView } from "@/lib/forum-self";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";

export const metadata: Metadata = { title: "邮箱验证" };

export default async function VerifyEmailPage() {
	const self = await getSelfForumUser();
	if (!self) {
		redirect("/login?redirect=/verify-email");
	}

	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = [
		{ label: homeLabel, href: "/", icon: "home" as const },
		{ label: "邮箱验证" },
	];

	return (
		<div className="flex flex-col gap-4">
			<Breadcrumbs items={breadcrumbs} />
			<EmailVerificationCard
				user={toEmailVerificationUserView(self)}
				capApiEndpoint={process.env.NEXT_PUBLIC_CAP_API_ENDPOINT}
				redirectAfterVerify="/"
			/>
		</div>
	);
}
