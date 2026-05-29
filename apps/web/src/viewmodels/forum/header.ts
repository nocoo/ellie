/**
 * Forum header ViewModel — pure types & data builders.
 *
 * Defines the data contract for the classic Discuz-style forum header.
 */

import type { SettingsMap } from "./settings.server";
import { getArr, getStr } from "./settings.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Current user info displayed in the top bar */
export interface HeaderUserInfo {
	username: string;
	uid: number;
	/** User group display name, e.g. "管理员" */
	groupTitle: string;
	/** Credit/point score */
	credits: number;
	/** Secondary currency (同钱) */
	coins: number;
	/** Unread reminder/notification count */
	reminderCount: number;
	/** User role (0=user, 1=admin, 2=supermod, 3=mod) */
	role: number;
}

/** A single navigation tab in the blue category bar */
export interface HeaderNavTab {
	label: string;
	href: string;
	/** Whether this tab is currently active */
	active?: boolean;
}

/** A hot search keyword shown next to the search bar */
export interface HotKeyword {
	label: string;
	href: string;
}

/** Site statistics shown at the bottom of the header */
export interface HeaderStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalPosts: number;
	totalMembers: number;
}

/** Aggregated header data consumed by header components */
export interface HeaderViewModel {
	user: HeaderUserInfo | null;
	navTabs: HeaderNavTab[];
	hotKeywords: HotKeyword[];
	stats: HeaderStats;
	logoLight: string;
	logoDark: string;
	logoAlt: string;
	homeLabel: string;
}

// ---------------------------------------------------------------------------
// Navigation tabs — fallback default when settings unavailable
// ---------------------------------------------------------------------------

const DEFAULT_NAV_TABS_TAIL: HeaderNavTab[] = [
	{ label: "就业实习", href: "/forums/2" },
	{ label: "导读", href: "/digest" },
	{ label: "考研", href: "/forums/3" },
	{ label: "嘉定新风", href: "/forums/4" },
	{ label: "同济闲话", href: "/forums/5" },
	{ label: "情感空间", href: "/forums/6" },
	{ label: "鹊桥", href: "/forums/7" },
	{ label: "竞猜", href: "/forums/8" },
	{ label: "签到", href: "/checkin" },
	{ label: "道具", href: "/forums/10" },
];

// ---------------------------------------------------------------------------
// Hot search keywords (static placeholder list)
// ---------------------------------------------------------------------------

export const HOT_KEYWORDS: HotKeyword[] = [
	{ label: "空调", href: "/search?q=空调" },
	{ label: "自行车", href: "/search?q=自行车" },
	{ label: "租房", href: "/search?q=租房" },
	{ label: "短租", href: "/search?q=短租" },
	{ label: "同济新村", href: "/search?q=同济新村" },
	{ label: "上海大众", href: "/search?q=上海大众" },
	{ label: "电视机", href: "/search?q=电视机" },
	{ label: "上城名都", href: "/search?q=上城名都" },
	{ label: "吉他", href: "/search?q=吉他" },
	{ label: "搬家", href: "/search?q=搬家" },
	{ label: "智齿", href: "/search?q=智齿" },
	{ label: "拔牙", href: "/search?q=拔牙" },
	{ label: "健身房", href: "/search?q=健身房" },
];

// ---------------------------------------------------------------------------
// Default stats (shown when API data is unavailable)
// ---------------------------------------------------------------------------

export const DEFAULT_STATS: HeaderStats = {
	todayPosts: 0,
	yesterdayPosts: 0,
	totalThreads: 0,
	totalPosts: 0,
	totalMembers: 0,
};

// ---------------------------------------------------------------------------
// Build the full view model
// ---------------------------------------------------------------------------

export function buildHeaderViewModel(
	settings: SettingsMap,
	user: HeaderUserInfo | null = null,
	stats: HeaderStats = DEFAULT_STATS,
): HeaderViewModel {
	const headerLinks = getArr<{ label: string; url: string }>(
		settings,
		"general.navigation.header_links",
		[],
	);

	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");

	const navTabs: HeaderNavTab[] =
		headerLinks.length > 0
			? headerLinks.map((link) => ({ label: link.label, href: link.url }))
			: [{ label: homeLabel, href: "/" }, ...DEFAULT_NAV_TABS_TAIL];

	return {
		user,
		navTabs,
		hotKeywords: HOT_KEYWORDS,
		stats,
		logoLight: getStr(
			settings,
			"general.site.logo_light",
			"https://t.no.mt/ellie/Logo-light-2.png",
		),
		logoDark: getStr(settings, "general.site.logo_dark", "https://t.no.mt/ellie/Logo-dark-2.png"),
		logoAlt: getStr(settings, "general.site.name", "Ellie"),
		homeLabel,
	};
}
