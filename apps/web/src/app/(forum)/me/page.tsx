// Route: /me — the authenticated user's "self" page.
//
// Phase 6 C-4 scope (per reviewer msg 0bb2fc12)
// ---------------------------------------------
// This is intentionally a small landing page that renders the
// EmailVerificationCard inside a `#email` section so the dialog/banner
// CTAs from Phase 7 can deep-link to `/me#email`. More /me sections will
// land in later phases (profile, notifications, etc.) — this commit
// establishes the route + auth gate + email card mount only.
//
// Auth model
// ----------
// Server component. We resolve the current user via `getSelfForumUser()`
// (which decrypts the NextAuth cookie + calls `/api/v1/auth/me` directly
// — no GET proxy). When that returns null we redirect to
// `/login?redirect=/me` so the user lands back here after logging in.
//
// Why no client refetch
// ---------------------
// The card needs `{ email, emailVerifiedAt }` once at mount. After a
// successful verify the card calls `router.refresh()` which re-runs this
// server component, picks up the new `emailVerifiedAt`, and the card
// re-renders into its verified branch on the next paint. There is no
// long-lived client store to keep in sync.

import { EmailVerificationCard } from "@/components/forum/email-verification-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getSelfForumUser, toEmailVerificationUserView } from "@/lib/forum-self";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "我的账号" };

export default async function MePage() {
	const self = await getSelfForumUser();
	if (!self) {
		// Auth gate — bounce to login with a redirect-back so the user lands
		// on /me after sign-in. Per reviewer guidance: the page is a "logged-in
		// only" surface; do not render a partial / anonymous fallback.
		redirect("/login?redirect=/me");
	}

	const breadcrumbs = [{ label: "首页", href: "/", icon: "home" as const }, { label: "我的账号" }];

	return (
		<div className="flex flex-col gap-4">
			<Breadcrumbs items={breadcrumbs} />

			{/* The id="email" anchor is the deep-link target for Phase 7's
			    write-button dialog and the banner CTA — both will navigate to
			    `/me#email` to scroll the card into view. */}
			<section id="email" aria-labelledby="email-section-heading" className="scroll-mt-20">
				<h2 id="email-section-heading" className="sr-only">
					邮箱验证
				</h2>
				<EmailVerificationCard
					user={toEmailVerificationUserView(self)}
					turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
				/>
			</section>
		</div>
	);
}
