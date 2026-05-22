import {
	DEFAULT_ONLINE_STATS,
	FOOTER_QUICK_LINKS,
	type OnlineStats,
	buildGlobalFooterViewModel,
	buildHomeFooterViewModel,
} from "@/viewmodels/forum/footer";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// buildHomeFooterViewModel
// ---------------------------------------------------------------------------

describe("buildHomeFooterViewModel", () => {
	const emptySettings = {};

	it("returns default zero stats when called with empty settings", () => {
		const vm = buildHomeFooterViewModel(emptySettings);
		expect(vm.onlineStats.totalOnline).toBe(0);
		expect(vm.onlineStats.peakOnline).toBe(0);
		expect(vm.onlineStats.peakDate).toBe("");
	});

	it("uses provided online stats", () => {
		const stats: OnlineStats = {
			totalOnline: 42,
			peakOnline: 999,
			peakDate: "2024-01-15",
		};
		const vm = buildHomeFooterViewModel(emptySettings, stats);
		expect(vm.onlineStats).toEqual(stats);
	});

	it("returns empty friend links when not configured in settings", () => {
		const vm = buildHomeFooterViewModel(emptySettings);
		expect(vm.friendLinks).toEqual([]);
	});

	it("uses custom friend links from settings when provided", () => {
		const settings = {
			"general.navigation.friend_links": [
				{ label: "Link A", url: "https://a.com" },
				{ label: "Link B", url: "https://b.com" },
			],
		};
		const vm = buildHomeFooterViewModel(settings);
		expect(vm.friendLinks).toEqual([
			{ label: "Link A", href: "https://a.com" },
			{ label: "Link B", href: "https://b.com" },
		]);
	});
});

// ---------------------------------------------------------------------------
// buildGlobalFooterViewModel
// ---------------------------------------------------------------------------

describe("buildGlobalFooterViewModel", () => {
	const emptySettings = {};

	it("returns footer with quick links and copyright", () => {
		const vm = buildGlobalFooterViewModel(emptySettings);
		expect(vm.quickLinks).toBe(FOOTER_QUICK_LINKS);
		expect(vm.quickLinks.length).toBeGreaterThan(0);
		expect(vm.copyrightHolder).toBeTruthy();
	});

	it("uses siteName from settings", () => {
		const settings = {
			"general.site.name": "My Forum",
		};
		const vm = buildGlobalFooterViewModel(settings);
		expect(vm.siteName).toBe("My Forum");
	});

	it("uses default siteName when not in settings", () => {
		const vm = buildGlobalFooterViewModel(emptySettings);
		expect(vm.siteName).toBe("Ellie");
	});

	it("reads copyrightYears from settings", () => {
		const settings = { "general.site.copyright_years": "2020-2026" };
		const vm = buildGlobalFooterViewModel(settings);
		expect(vm.copyrightYears).toBe("2020-2026");
	});

	it("defaults copyrightYears to 2001-2013", () => {
		const vm = buildGlobalFooterViewModel(emptySettings);
		expect(vm.copyrightYears).toBe("2001-2013");
	});

	it("reads brand logo URLs from settings", () => {
		const settings = {
			"general.site.logo_light": "https://cdn.example.com/logo-light.png",
			"general.site.logo_dark": "https://cdn.example.com/logo-dark.png",
		};
		const vm = buildGlobalFooterViewModel(settings);
		expect(vm.logoLight).toBe("https://cdn.example.com/logo-light.png");
		expect(vm.logoDark).toBe("https://cdn.example.com/logo-dark.png");
	});

	it("reads footer background URLs from settings", () => {
		const settings = {
			"general.site.footer_bg_light": "https://cdn.example.com/bg-light.png",
			"general.site.footer_bg_dark": "https://cdn.example.com/bg-dark.png",
		};
		const vm = buildGlobalFooterViewModel(settings);
		expect(vm.bgLight).toBe("https://cdn.example.com/bg-light.png");
		expect(vm.bgDark).toBe("https://cdn.example.com/bg-dark.png");
	});

	it("uses fallback brand URLs when settings are empty", () => {
		const vm = buildGlobalFooterViewModel(emptySettings);
		expect(vm.logoLight).toContain("Logo-light");
		expect(vm.logoDark).toContain("Logo-dark");
		expect(vm.bgLight).toContain("Bg-shanghai-light");
		expect(vm.bgDark).toContain("Bg-shanghai-dark");
	});

	it("reads homeLabel from settings", () => {
		const settings = { "general.site.home_label": "My Site" };
		const vm = buildGlobalFooterViewModel(settings);
		expect(vm.homeLabel).toBe("My Site");
	});

	it("defaults homeLabel to 同济网论坛", () => {
		const vm = buildGlobalFooterViewModel(emptySettings);
		expect(vm.homeLabel).toBe("同济网论坛");
	});
});

// ---------------------------------------------------------------------------
// DEFAULT_ONLINE_STATS
// ---------------------------------------------------------------------------

describe("DEFAULT_ONLINE_STATS", () => {
	it("has all fields set to zero/empty", () => {
		expect(DEFAULT_ONLINE_STATS.totalOnline).toBe(0);
		expect(DEFAULT_ONLINE_STATS.peakOnline).toBe(0);
		expect(DEFAULT_ONLINE_STATS.peakDate).toBe("");
	});
});
