import {
	DEFAULT_STATS,
	HOT_KEYWORDS,
	type HeaderStats,
	type HeaderUserInfo,
	buildHeaderViewModel,
} from "@/viewmodels/forum/header";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// buildHeaderViewModel
// ---------------------------------------------------------------------------

describe("buildHeaderViewModel", () => {
	const emptySettings = {};

	it("returns null user and zero stats when called with empty settings", () => {
		const vm = buildHeaderViewModel(emptySettings);
		expect(vm.user).toBeNull();
		expect(vm.stats.todayPosts).toBe(0);
		expect(vm.stats.yesterdayPosts).toBe(0);
		expect(vm.stats.totalThreads).toBe(0);
		expect(vm.stats.totalMembers).toBe(0);
		expect(vm.stats.newestMember).toBe("");
	});

	it("uses provided user when given", () => {
		const user: HeaderUserInfo = {
			username: "alice",
			uid: 42,
			groupTitle: "版主",
			credits: 500,
			reminderCount: 3,
		};
		const vm = buildHeaderViewModel(emptySettings, user);
		expect(vm.user).toEqual(user);
	});

	it("uses provided stats when given", () => {
		const stats: HeaderStats = {
			todayPosts: 10,
			yesterdayPosts: 20,
			totalThreads: 5000,
			totalMembers: 1234,
			newestMember: "bob",
		};
		const vm = buildHeaderViewModel(emptySettings, null, stats);
		expect(vm.stats).toEqual(stats);
	});

	it("always includes navTabs and hotKeywords", () => {
		const vm = buildHeaderViewModel(emptySettings);
		expect(vm.navTabs.length).toBeGreaterThan(0);
		expect(vm.hotKeywords).toBe(HOT_KEYWORDS);
		expect(vm.hotKeywords.length).toBeGreaterThan(0);
	});

	it("uses custom navTabs from settings when provided", () => {
		const settings = {
			"general.navigation.header_links": [
				{ label: "Home", url: "/" },
				{ label: "About", url: "/about" },
			],
		};
		const vm = buildHeaderViewModel(settings);
		expect(vm.navTabs).toEqual([
			{ label: "Home", href: "/" },
			{ label: "About", href: "/about" },
		]);
	});
});

// ---------------------------------------------------------------------------
// DEFAULT_STATS
// ---------------------------------------------------------------------------

describe("DEFAULT_STATS", () => {
	it("has all fields set to zero/empty", () => {
		expect(DEFAULT_STATS.todayPosts).toBe(0);
		expect(DEFAULT_STATS.yesterdayPosts).toBe(0);
		expect(DEFAULT_STATS.totalThreads).toBe(0);
		expect(DEFAULT_STATS.totalMembers).toBe(0);
		expect(DEFAULT_STATS.newestMember).toBe("");
	});
});
