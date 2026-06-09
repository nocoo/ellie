import { describe, expect, it } from "vitest";
import {
	buildHeaderViewModel,
	DEFAULT_STATS,
	type HeaderStats,
	type HeaderUserInfo,
	HOT_KEYWORDS,
} from "@/viewmodels/forum/header";

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
	});

	it("uses provided user when given", () => {
		const user: HeaderUserInfo = {
			username: "alice",
			uid: 42,
			groupTitle: "版主",
			credits: 500,
			coins: 100,
			reminderCount: 3,
			role: 0,
		};
		const vm = buildHeaderViewModel(emptySettings, user);
		expect(vm.user).toEqual(user);
	});

	it("uses provided stats when given", () => {
		const stats: HeaderStats = {
			todayPosts: 10,
			yesterdayPosts: 20,
			totalThreads: 5000,
			totalPosts: 1000,
			totalMembers: 1234,
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

	it("fallback DEFAULT_NAV_TABS includes 签到 -> /checkin", () => {
		const vm = buildHeaderViewModel(emptySettings);
		const checkin = vm.navTabs.find((t) => t.label === "签到");
		expect(checkin).toBeDefined();
		expect(checkin?.href).toBe("/checkin");
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

	it("uses homeLabel from settings in default nav tabs", () => {
		const settings = { "general.site.home_label": "My Forum" };
		const vm = buildHeaderViewModel(settings);
		expect(vm.navTabs[0]).toEqual({ label: "My Forum", href: "/" });
		expect(vm.homeLabel).toBe("My Forum");
	});

	it("default nav tabs first item uses fallback homeLabel", () => {
		const vm = buildHeaderViewModel(emptySettings);
		expect(vm.navTabs[0]).toEqual({ label: "同济网论坛", href: "/" });
		expect(vm.homeLabel).toBe("同济网论坛");
	});

	it("includes logoLight, logoDark, logoAlt from settings", () => {
		const settings = {
			"general.site.logo_light": "https://example.com/light.png",
			"general.site.logo_dark": "https://example.com/dark.png",
			"general.site.name": "TestForum",
		};
		const vm = buildHeaderViewModel(settings);
		expect(vm.logoLight).toBe("https://example.com/light.png");
		expect(vm.logoDark).toBe("https://example.com/dark.png");
		expect(vm.logoAlt).toBe("TestForum");
	});
});

// ---------------------------------------------------------------------------
// DEFAULT_STATS
// ---------------------------------------------------------------------------

describe("DEFAULT_STATS", () => {
	it("has all fields set to zero", () => {
		expect(DEFAULT_STATS.todayPosts).toBe(0);
		expect(DEFAULT_STATS.yesterdayPosts).toBe(0);
		expect(DEFAULT_STATS.totalThreads).toBe(0);
		expect(DEFAULT_STATS.totalMembers).toBe(0);
	});
});
