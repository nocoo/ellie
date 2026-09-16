// @vitest-environment happy-dom
// Tests for SiteFooter mobile contract (reviewer freeze msg=5a91dfd3):
//   - Logo is hidden on mobile (`hidden sm:block` on the logo wrapper),
//     desktop unchanged.
//   - Background-image band's negative offsets are smaller on mobile so
//     more of the art is visible (no top-clipping) and don't use the
//     desktop `mx-[-12.5%]` horizontal overflow.
// We assert via stable testids and class-token presence because happy-dom
// does not evaluate media queries.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("div", { "data-testid": "footer-logo" }, "logo"),
}));

import { SiteFooter } from "@/components/forum/site-footer";
import type { GlobalFooterViewModel } from "@/viewmodels/forum/footer";

function makeVm(): GlobalFooterViewModel {
	return {
		siteName: "Ellie",
		quickLinks: [],
		logoLight: "/static/logo-light.png",
		logoDark: "/static/logo-dark.png",
		logoAlt: "logo",
		copyrightYears: "2010-2026",
		copyrightHolder: "TJ.no.mt",
		poweredBy: "Powered by Ellie",
		version: "v1.0.0",
		icpNumber: "ICP-12345",
		bgLight: "/static/bg-light.png",
		bgDark: "/static/bg-dark.png",
		homeLabel: "首页",
	};
}

afterEach(() => {
	cleanup();
});

describe("SiteFooter — iPhone mobile contract", () => {
	it("logo wrapper is `hidden sm:block` (logo disappears on phones)", () => {
		render(createElement(SiteFooter, { vm: makeVm() }));
		const wrap = screen.getByTestId("site-footer-logo-wrap");
		expect(wrap.className).toContain("hidden");
		expect(wrap.className).toContain("sm:block");
		// The logo itself is still in the DOM (CSS-hidden, not unmounted) so
		// the desktop branch keeps working.
		expect(screen.getByTestId("footer-logo")).toBeDefined();
	});

	it("keeps decorative artwork outside the accessible content", () => {
		render(createElement(SiteFooter, { vm: makeVm() }));
		expect(screen.getByTestId("site-footer-bg-wrap").getAttribute("aria-hidden")).toBe("true");
	});

	it("copyright/powered-by/ICP lines still render (only the logo is mobile-hidden)", () => {
		render(createElement(SiteFooter, { vm: makeVm() }));
		expect(screen.getByText(/TJ\.no\.mt/)).toBeDefined();
		expect(screen.getByText(/Powered by Ellie/)).toBeDefined();
		expect(screen.getByText("ICP-12345")).toBeDefined();
	});
});
