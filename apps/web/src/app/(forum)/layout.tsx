import { EmailVerificationBanner } from "@/components/forum/email-verification-banner";
import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import { MaintenancePage } from "@/components/maintenance-page";
import { forumApi } from "@/lib/forum-api";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { getSelfForumUser } from "@/lib/forum-self";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import {
	type HeaderStats,
	type HeaderUserInfo,
	buildHeaderViewModel,
} from "@/viewmodels/forum/header";
import { fetchPublicSettings, getBool, getStr } from "@/viewmodels/forum/settings.server";
import type { SiteStats } from "@/viewmodels/forum/stats.server";
import type { PublicUser } from "@ellie/types";
import type { Metadata } from "next";
import type { ReactNode } from "react";

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
	// First, fetch settings to check maintenance mode
	const settings = await fetchPublicSettings();
	const isMaintenanceMode = getBool(settings, "features.access.maintenance_mode", false);
	const adminBypass = getBool(settings, "features.access.maintenance_admin_bypass", false);

	// If maintenance mode is on, check if admin bypass is enabled
	if (isMaintenanceMode) {
		let canBypass = false;

		if (adminBypass) {
			// Check if current user is a forum admin (role = 1)
			const currentUser = await loadCurrentUser();
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

	// Normal mode — load all data. `self` is loaded separately from
	// `currentUser` because the header viewmodel only needs the public
	// projection; the email-verification banner needs `emailVerifiedAt`
	// which lives on the self-shape. Both calls fail-soft to null so a
	// transient Worker outage doesn't block the layout from rendering.
	const [stats, currentUser, self] = await Promise.all([
		loadStats(),
		loadCurrentUser(),
		getSelfForumUser(),
	]);

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

/** Load site-wide stats from Worker API. Returns defaults on failure. */
async function loadStats(): Promise<HeaderStats> {
	try {
		const { data } = await forumApi.get<SiteStats>("/api/v1/stats");
		return {
			todayPosts: data.todayPosts,
			yesterdayPosts: data.yesterdayPosts,
			totalThreads: data.totalThreads,
			totalPosts: data.totalPosts,
			totalMembers: data.totalMembers,
			newestMember: data.newestMember,
		};
	} catch {
		// Graceful degradation — show zeroes instead of crashing
		return {
			todayPosts: 0,
			yesterdayPosts: 0,
			totalThreads: 0,
			totalPosts: 0,
			totalMembers: 0,
			newestMember: "",
		};
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
			reminderCount: 0, // TODO: wire when messaging system is built
			role: user.role,
		};
	} catch {
		return null;
	}
}
