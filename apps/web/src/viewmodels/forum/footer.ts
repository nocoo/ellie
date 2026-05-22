/**
 * Forum footer ViewModel — pure types & data builders.
 *
 * Defines the data contract for the classic Discuz-style forum footer.
 * Split into two sections:
 * - Home-only: online stats, friend links (above the divider)
 * - Global: powered-by, copyright, site links (below the divider)
 */

import { VERSION_DISPLAY } from "@ellie/types";
import type { SettingsMap } from "./settings.server";
import { getArr, getStr } from "./settings.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Online member statistics shown on the homepage */
export interface OnlineStats {
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

/** A single friend link entry */
export interface FriendLink {
	label: string;
	href: string;
}

/** A quick link in the global footer bar (e.g. 站点统计, 举报) */
export interface FooterQuickLink {
	label: string;
	href: string;
}

/** Homepage-only footer section data */
export interface HomeFooterViewModel {
	onlineStats: OnlineStats;
	friendLinks: FriendLink[];
}

/** Global footer section data (shared across all pages) */
export interface GlobalFooterViewModel {
	siteName: string;
	quickLinks: FooterQuickLink[];
	icpNumber: string;
	poweredBy: string;
	version: string;
	copyrightYears: string;
	copyrightHolder: string;
	logoLight: string;
	logoDark: string;
	logoAlt: string;
	bgLight: string;
	bgDark: string;
}

// ---------------------------------------------------------------------------
// Default online stats (shown when real data is unavailable)
// ---------------------------------------------------------------------------

export const DEFAULT_ONLINE_STATS: OnlineStats = {
	totalOnline: 0,
	peakOnline: 0,
	peakDate: "",
};

// No default friend links — must be configured via admin panel

export const FOOTER_QUICK_LINKS: FooterQuickLink[] = [
	{ label: "广告联系:hi@tongji.net", href: "mailto:hi@tongji.net" },
	{ label: "站点统计", href: "#" },
	{ label: "举报", href: "#" },
	{ label: "小黑屋", href: "#" },
	{ label: "手机版", href: "#" },
	{ label: "Archiver", href: "#" },
];

// ---------------------------------------------------------------------------
// Build view models
// ---------------------------------------------------------------------------

export function buildHomeFooterViewModel(
	settings: SettingsMap,
	onlineStats: OnlineStats = DEFAULT_ONLINE_STATS,
): HomeFooterViewModel {
	const friendLinks = getArr<{ label: string; url: string }>(
		settings,
		"general.navigation.friend_links",
		[],
	);

	return {
		onlineStats,
		friendLinks: friendLinks.map((link) => ({ label: link.label, href: link.url })),
	};
}

export function buildGlobalFooterViewModel(settings: SettingsMap): GlobalFooterViewModel {
	return {
		siteName: getStr(settings, "general.site.name", "Ellie"),
		quickLinks: FOOTER_QUICK_LINKS,
		icpNumber: getStr(settings, "general.site.icp_number", ""),
		poweredBy: getStr(settings, "general.site.powered_by", "Discuz! X3.2"),
		version: VERSION_DISPLAY,
		copyrightYears: getStr(settings, "general.site.copyright_years", "2001-2013"),
		copyrightHolder: getStr(settings, "general.site.copyright", "Comsenz Inc."),
		logoLight: getStr(
			settings,
			"general.site.logo_light",
			"https://t.no.mt/ellie/Logo-light-2.png",
		),
		logoDark: getStr(settings, "general.site.logo_dark", "https://t.no.mt/ellie/Logo-dark-2.png"),
		logoAlt: getStr(settings, "general.site.name", "Ellie"),
		bgLight: getStr(
			settings,
			"general.site.footer_bg_light",
			"https://t.no.mt/ellie/Bg-shanghai-light.png",
		),
		bgDark: getStr(
			settings,
			"general.site.footer_bg_dark",
			"https://t.no.mt/ellie/Bg-shanghai-dark.png",
		),
	};
}
