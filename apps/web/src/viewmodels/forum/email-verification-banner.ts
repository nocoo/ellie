/**
 * Email-verification banner viewmodel.
 *
 * Pure decision: given the current user's projected `emailVerifiedAt`,
 * decide whether to render the banner and what copy/CTA to show.
 *
 * Why server-side and gated tightly
 * ---------------------------------
 * Reviewer mandate (msg 36d22406): the banner is a passive prompt only.
 * - Render only when the user is logged in AND their email is unverified
 *   (`emailVerifiedAt === 0`). Anonymous users get nothing — they can
 *   still browse and the banner would be misleading.
 * - The banner does NOT block any page. It does NOT replace the §5.4
 *   dialog or the backend 403 fallback — those are the source of truth
 *   for "this write was rejected". The banner is a heads-up so an
 *   unverified user can fix the situation before they hit a write surface.
 * - Empty email (unbound) is still "unverified" for our purposes — both
 *   states surface as `emailVerifiedAt === 0` from the Worker. The banner
 *   copy needs to read sensibly for both, so we deliberately avoid
 *   mentioning "verify the email at <address>".
 */

import type { SelfForumUser } from "@/lib/forum-self";

export interface EmailVerificationBannerVm {
	/** Whether to render the banner at all. */
	visible: boolean;
	/** Heading line above the body. */
	title: string;
	/** Body line; one short paragraph. */
	body: string;
	/** Label for the only CTA. */
	ctaLabel: string;
	/** Same-site relative URL. */
	ctaHref: string;
}

/**
 * Render decision.
 *
 * - `null` self → user is not logged in → hide. The forum layout shows
 *   sign-in affordances elsewhere; the banner staying out of anonymous
 *   pages keeps it from confusing visitors who can already browse.
 * - `emailVerifiedAt > 0` → already verified → hide.
 * - Otherwise → show with the canonical copy.
 *
 * The CTA always points to `/me#email`. The §5.4 dialog's `redirect_to`
 * may be richer (e.g. carry a write-context query string), but the banner
 * is a static "go fix this in your account" prompt — there is no write
 * context to carry from a passive page render.
 */
export function pickEmailVerificationBannerVm(
	self: SelfForumUser | null,
): EmailVerificationBannerVm {
	if (self == null) return hidden();
	if (self.emailVerifiedAt > 0) return hidden();
	return {
		visible: true,
		title: "邮箱未验证",
		body: "你的账号还未验证邮箱，目前只能浏览。验证邮箱后即可发帖、回帖和私信。",
		ctaLabel: "去验证邮箱",
		ctaHref: "/me#email",
	};
}

function hidden(): EmailVerificationBannerVm {
	return { visible: false, title: "", body: "", ctaLabel: "", ctaHref: "" };
}
