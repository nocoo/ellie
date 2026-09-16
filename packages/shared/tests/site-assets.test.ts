import { describe, expect, it } from "vitest";
import { FORUM_LOGOS, resolveSiteAsset, SITE_ART, siteArtworkBackground } from "../src/site-assets";

describe("shipped site artwork migration", () => {
	it("upgrades existing R2 settings without changing custom or disabled assets", () => {
		expect(resolveSiteAsset("https://t.no.mt/ellie/Logo-light-2.png")).toBe(FORUM_LOGOS.light);
		expect(resolveSiteAsset("https://t.no.mt/ellie/Logo-dark.jpg")).toBe(FORUM_LOGOS.dark);
		expect(resolveSiteAsset("https://t.no.mt/ellie/bg_footer_light_01.jpg")).toBe(
			SITE_ART.footer.light.src,
		);
		expect(resolveSiteAsset("https://t.no.mt/ellie/site/1.10.1/footer-light-384.webp")).toBe(
			SITE_ART.footer.light.src,
		);
		for (const custom of ["https://example.com/custom.png?v=2", "/own-logo.svg", "", "toString"]) {
			expect(resolveSiteAsset(custom)).toBe(custom);
		}
	});

	it("uses retina art for legacy settings and safely preserves custom CSS URLs", () => {
		expect(siteArtworkBackground("https://t.no.mt/ellie/Bg-shanghai-dark.png")).toBe(
			SITE_ART.footer.dark.imageSet,
		);
		expect(siteArtworkBackground(SITE_ART.header.light.src)).toContain("header-light-1536.webp");
		expect(siteArtworkBackground(SITE_ART.admin.dark.src)).toContain("admin-dark-768.webp");
		expect(siteArtworkBackground('https://example.com/art (1).png?name="test"')).toBe(
			'url("https://example.com/art (1).png?name=\\"test\\"")',
		);
		expect(siteArtworkBackground("")).toBe("none");
		expect(siteArtworkBackground("toString")).toBe('url("toString")');
	});
});
