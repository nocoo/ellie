/**
 * Forum footer ViewModel — pure types & data builders.
 *
 * Defines the data contract for the classic Discuz-style forum footer.
 * Split into two sections:
 * - Home-only: online stats, friend links (above the divider)
 * - Global: powered-by, copyright, site links (below the divider)
 */

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
	quickLinks: FooterQuickLink[];
	icpNumber: string;
	poweredBy: string;
	copyrightYears: string;
	copyrightHolder: string;
}

// ---------------------------------------------------------------------------
// Default online stats (shown when real data is unavailable)
// ---------------------------------------------------------------------------

export const DEFAULT_ONLINE_STATS: OnlineStats = {
	totalOnline: 0,
	peakOnline: 0,
	peakDate: "",
};

export const FRIEND_LINKS: FriendLink[] = [
	{ label: "旺旺英语", href: "#" },
	{ label: "沪江英语论坛", href: "#" },
	{ label: "蓝色理想", href: "#" },
	{ label: "苏州大学", href: "#" },
	{ label: "上大自在居", href: "#" },
	{ label: "传世私服", href: "#" },
	{ label: "上海理工", href: "#" },
	{ label: "松江大学城", href: "#" },
	{ label: "东北大学论坛", href: "#" },
	{ label: "IT世界网校园频", href: "#" },
	{ label: "华工烟亭", href: "#" },
	{ label: "土木工程网", href: "#" },
	{ label: "华东理工大学论", href: "#" },
	{ label: "浙江海洋碧海潮", href: "#" },
	{ label: "地理中国", href: "#" },
	{ label: "复旦相辉堂论坛", href: "#" },
	{ label: "东华大学", href: "#" },
	{ label: "华东师范大学", href: "#" },
	{ label: "中央民族大学", href: "#" },
	{ label: "东北大学研究生", href: "#" },
	{ label: "传奇私服", href: "#" },
	{ label: "电力学院论坛", href: "#" },
	{ label: "中南林业科技大", href: "#" },
	{ label: "同济大学浙江学", href: "#" },
	{ label: "新博思考研网", href: "#" },
	{ label: "西林论坛", href: "#" },
	{ label: "西北政法大学", href: "#" },
	{ label: "山东政法学院", href: "#" },
];

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
	onlineStats: OnlineStats = DEFAULT_ONLINE_STATS,
): HomeFooterViewModel {
	return {
		onlineStats,
		friendLinks: FRIEND_LINKS,
	};
}

export function buildGlobalFooterViewModel(): GlobalFooterViewModel {
	return {
		quickLinks: FOOTER_QUICK_LINKS,
		icpNumber: "沪ICP备05003615号",
		poweredBy: "Discuz! X3.2",
		copyrightYears: "2001-2013",
		copyrightHolder: "Comsenz Inc.",
	};
}
