// Tests for the email-verification banner viewmodel
// (apps/web/src/viewmodels/forum/email-verification-banner.ts).
//
// The banner has a deliberately narrow visibility contract:
//   - hide for anonymous users (self === null) — they see sign-in CTAs
//     elsewhere; a verification banner would be misleading
//   - hide for verified users (emailVerifiedAt > 0)
//   - show for logged-in unverified users (emailVerifiedAt === 0),
//     including users who haven't bound an email yet (empty email)
//
// Reviewer (msg 36d22406): the banner is a passive prompt, not a gate
// or replacement for the §5.4 dialog. We pin the CTA target to /me#email
// so it always lands on the canonical verification card regardless of
// where the user clicked from.

import type { SelfForumUser } from "@/lib/forum-self";
import { pickEmailVerificationBannerVm } from "@/viewmodels/forum/email-verification-banner";
import { describe, expect, it } from "vitest";

function makeSelf(overrides: Partial<SelfForumUser> = {}): SelfForumUser {
	return {
		id: 1,
		username: "alice",
		email: "alice@example.com",
		emailVerifiedAt: 0,
		...overrides,
	};
}

describe("pickEmailVerificationBannerVm", () => {
	it("hides for anonymous users (self === null)", () => {
		const vm = pickEmailVerificationBannerVm(null);
		expect(vm.visible).toBe(false);
		// Hidden vm fields should be empty so a careless render that
		// ignores `visible` doesn't leak a partial banner.
		expect(vm.title).toBe("");
		expect(vm.body).toBe("");
		expect(vm.ctaLabel).toBe("");
		expect(vm.ctaHref).toBe("");
	});

	it("hides for verified users (emailVerifiedAt > 0)", () => {
		const vm = pickEmailVerificationBannerVm(
			makeSelf({ email: "v@x.io", emailVerifiedAt: 1700000000 }),
		);
		expect(vm.visible).toBe(false);
	});

	it("shows for logged-in unverified users with a bound email", () => {
		const vm = pickEmailVerificationBannerVm(makeSelf({ email: "u@x.io", emailVerifiedAt: 0 }));
		expect(vm.visible).toBe(true);
		expect(vm.title).toBe("邮箱未验证");
		expect(vm.body).toContain("发帖");
		expect(vm.ctaLabel).toBe("去验证邮箱");
		expect(vm.ctaHref).toBe("/me#email");
	});

	it("shows for unbound users (empty email + emailVerifiedAt 0)", () => {
		// Unbound users still need to see the banner so they bind+verify
		// in one trip. The copy intentionally avoids naming an email
		// address so it reads sensibly when none is set yet.
		const vm = pickEmailVerificationBannerVm(makeSelf({ email: "", emailVerifiedAt: 0 }));
		expect(vm.visible).toBe(true);
		expect(vm.body.length).toBeGreaterThan(0);
	});

	it("never points the CTA anywhere except /me#email", () => {
		// The banner is context-free; it must always land on the canonical
		// card. The §5.4 dialog has its own redirect_to that may carry
		// extra context — that path is independent of this one.
		for (const t of [0, 1] as const) {
			const vm = pickEmailVerificationBannerVm(makeSelf({ emailVerifiedAt: t }));
			if (vm.visible) expect(vm.ctaHref).toBe("/me#email");
		}
	});
});
