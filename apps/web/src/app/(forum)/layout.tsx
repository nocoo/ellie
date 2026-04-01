import { ForumLayoutShell } from "@/components/forum/forum-layout";
import { SessionGuard } from "@/components/forum/session-guard";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { forumApi } from "@/lib/forum-api";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import { type HeaderStats, type HeaderUserInfo, buildHeaderViewModel } from "@/viewmodels/forum/header";
import type { SiteStats } from "@/viewmodels/forum/stats.server";
import type { PublicUser } from "@ellie/types";
import type { ReactNode } from "react";

export default async function ForumLayout({ children }: { children: ReactNode }) {
	// Fetch stats and user in parallel
	const [stats, currentUser] = await Promise.all([loadStats(), loadCurrentUser()]);

	const headerVm = buildHeaderViewModel(currentUser, stats);
	const footerVm = buildGlobalFooterViewModel();

	return (
		<ForumLayoutShell headerVm={headerVm} footerVm={footerVm}>
			<SessionGuard />
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
			totalMembers: data.totalMembers,
			newestMember: data.newestMember,
		};
	} catch {
		// Graceful degradation — show zeroes instead of crashing
		return {
			todayPosts: 0,
			yesterdayPosts: 0,
			totalThreads: 0,
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
		};
	} catch {
		return null;
	}
}
