import { describe, expect, it } from "vitest";
import {
	DEFAULT_ONLINE_STATS,
	FOOTER_QUICK_LINKS,
	type OnlineStats,
	buildGlobalFooterViewModel,
	buildHomeFooterViewModel,
} from "../../../../apps/web/src/viewmodels/forum/footer";

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
