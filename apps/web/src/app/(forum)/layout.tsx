import type { PublicUser } from "@ellie/types";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { EmailVerificationBanner } from "@/components/forum/email-verification-banner";
import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import { MaintenancePage } from "@/components/maintenance-page";
import { forumApi } from "@/lib/forum-api";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { getCachedForumListContext, getCachedHomeContext } from "@/lib/forum-cache";
import { FORUM_LIST_LOCATION_HEADER, parseForumListLocation } from "@/lib/forum-list-location";
import { getSelfForumUser } from "@/lib/forum-self";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import {
	buildHeaderViewModel,
	DEFAULT_STATS,
	type HeaderStats,
	type HeaderUserInfo,
} from "@/viewmodels/forum/header";
import { fetchPublicSettings, getBool, getStr } from "@/viewmodels/forum/settings.server";
import { loadSiteStats } from "@/viewmodels/forum/stats.server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
	const settings = await fetchPublicSettings();
	const siteName = getStr(settings, "general.site.name", "Ellie");
	const subtitle = getStr(settings, "general.site.subtitle", "");

	const suffix = subtitle ? `${siteName} - ${subtitle}` : siteName;

	return {
		title: {
			template: `%s - ${suffix}`,
			default: suffix,
		},
		description: getStr(settings, "general.og.description", ""),
		openGraph: {
			title: getStr(settings, "general.og.title", "") || undefined,
			description: getStr(settings, "general.og.description", "") || undefined,
			siteName: getStr(settings, "general.og.site_name", "") || undefined,
			images: getStr(settings, "general.og.image", "")
				? [getStr(settings, "general.og.image", "")]
				: undefined,
			url: getStr(settings, "general.og.url", "") || undefined,
		},
		twitter: {
			card: getStr(settings, "general.og.twitter_card", "summary") as "summary",
			site: getStr(settings, "general.og.twitter_site", "") || undefined,
		},
	};
}

export default async function ForumLayout({ children }: { children: ReactNode }) {
	const requestHeaders = await headers();
	const isHome = requestHeaders.get("x-ellie-home") === "1";
	const isForumList =
		parseForumListLocation(requestHeaders.get(FORUM_LIST_LOCATION_HEADER)) !== null;
	const loadContext = isHome
		? getCachedHomeContext
		: isForumList
			? getCachedForumListContext
			: null;
	// First, fetch settings to check maintenance mode
	const settings = await fetchPublicSettings();
	const isMaintenanceMode = getBool(settings, "features.access.maintenance_mode", false);
	const adminBypass = getBool(settings, "features.access.maintenance_admin_bypass", false);

	// If maintenance mode is on, check if admin bypass is enabled
	if (isMaintenanceMode) {
		let canBypass = false;

		if (adminBypass) {
			// Check if current user is a forum admin (role = 1)
			const currentUser = loadContext
				? (await loadContext().catch(() => null))?.user
				: await loadCurrentUser();
			canBypass = currentUser?.role === 1;
		}

		if (!canBypass) {
			const message = getStr(
				settings,
				"features.access.maintenance_message",
				"系统维护中，请稍后再试...",
			);
			return <MaintenancePage message={message} />;
		}
	}

	const context = loadContext ? await loadContext().catch(() => null) : null;
	const [stats, currentUser, self] = loadContext
		? [
				context?.stats ?? DEFAULT_STATS,
				context?.user
					? {
							uid: context.user.id,
							username: context.user.username,
							groupTitle: context.user.groupTitle,
							credits: context.user.credits,
							coins: context.user.coins,
							role: context.user.role,
							reminderCount: 0,
						}
					: null,
				context?.user ?? null,
			]
		: await Promise.all([loadStats(), loadCurrentUser(), getSelfForumUser()]);

	const headerVm = buildHeaderViewModel(settings, currentUser, stats);
	const footerVm = buildGlobalFooterViewModel(settings);

	return (
		<ForumLayoutShell headerVm={headerVm} footerVm={footerVm}>
			<SessionGuard />
			<EmailVerificationBanner self={self} />
			{children}
		</ForumLayoutShell>
	);
}

/** Load bounded site statistics; return display defaults on failure. */
async function loadStats(): Promise<HeaderStats> {
	try {
		const data = await loadSiteStats();
		return {
			todayPosts: data.todayPosts,
			yesterdayPosts: data.yesterdayPosts,
			totalThreads: data.totalThreads,
			totalPosts: data.totalPosts,
			totalMembers: data.totalMembers,
		};
	} catch {
		return DEFAULT_STATS;
	}
}

/** Load current user info from NextAuth session + Worker API. */
async function loadCurrentUser(): Promise<HeaderUserInfo | null> {
	try {
		const forumUser = await getCurrentForumUser();
		if (!forumUser) return null;

		// Fetch full user profile for credits and group info
		const { data: user } = await forumApi.get<PublicUser>(`/api/v1/users/${forumUser.userId}`);

		return {
			username: user.username,
			uid: user.id,
			groupTitle: user.groupTitle,
			credits: user.credits,
			coins: user.coins,
			reminderCount: 0, // TODO: wire when messaging system is built
			role: user.role,
		};
	} catch {
		return null;
	}
}
