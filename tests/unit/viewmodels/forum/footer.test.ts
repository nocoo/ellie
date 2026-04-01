import { describe, expect, it } from "bun:test";
import {
	DEFAULT_ONLINE_STATS,
	FRIEND_LINKS,
	type OnlineStats,
	buildGlobalFooterViewModel,
	buildHomeFooterViewModel,
} from "../../../../apps/web/src/viewmodels/forum/footer";

// ---------------------------------------------------------------------------
// buildHomeFooterViewModel
// ---------------------------------------------------------------------------

describe("buildHomeFooterViewModel", () => {
	it("returns default zero stats when called with no args", () => {
		const vm = buildHomeFooterViewModel();
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
		const vm = buildHomeFooterViewModel(stats);
		expect(vm.onlineStats).toEqual(stats);
	});

	it("always includes friend links", () => {
		const vm = buildHomeFooterViewModel();
		expect(vm.friendLinks).toBe(FRIEND_LINKS);
		expect(vm.friendLinks.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// buildGlobalFooterViewModel
// ---------------------------------------------------------------------------

describe("buildGlobalFooterViewModel", () => {
	it("returns footer with quick links and copyright", () => {
		const vm = buildGlobalFooterViewModel();
		expect(vm.quickLinks.length).toBeGreaterThan(0);
		expect(vm.icpNumber).toBeTruthy();
		expect(vm.copyrightHolder).toBeTruthy();
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
