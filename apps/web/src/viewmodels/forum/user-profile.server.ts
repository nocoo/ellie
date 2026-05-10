// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id, /users/:id/threads, /users/:id/posts, /users/:id/digest).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCachedPageSize } from "@/lib/forum-cache";
import type { Post, PublicUser, Thread, User } from "@ellie/types";
import { type ProfileTab, resolveTab } from "./user-profile";

import { type PaginatedResult, emptyPage } from "@/viewmodels/shared/pagination";

export interface UserProfileData {
	user: User;
	tab: ProfileTab;
	threads: PaginatedResult<Thread>;
	posts: PaginatedResult<Post>;
	digest: PaginatedResult<Thread>;
}

export async function loadUserProfile(params: {
	userId: number;
	tab?: string;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<UserProfileData> {
	const tab = resolveTab(params.tab);

	// Parallel fetch: user profile + (page size → tab data)
	// These two chains are independent — user data is only needed for `total` counts,
	// not for the tab API call itself.
	const [{ data: publicUser }, tabResult] = await Promise.all([
		forumApi.get<PublicUser>(`/api/v1/users/${params.userId}`),
		fetchTabData(params, tab),
	]);

	const user = publicUserToUser(publicUser);

	// Merge tab results with user-derived totals (only when fetch succeeded)
	const totalMap: Record<ProfileTab, number> = {
		threads: user.threads,
		posts: user.posts,
		digest: user.digestPosts,
	};
	const total = tabResult.ok ? totalMap[tab] : 0;
	const tabPage = { ...tabResult, total };

	return {
		user,
		tab,
		threads: tab === "threads" ? (tabPage as PaginatedResult<Thread>) : emptyPage(),
		posts: tab === "posts" ? (tabPage as PaginatedResult<Post>) : emptyPage(),
		digest: tab === "digest" ? (tabPage as PaginatedResult<Thread>) : emptyPage(),
	};
}

type TabFetchResult<T> = PaginatedResult<T> & { ok: boolean };

/** Fetch page size then tab-specific data. Runs in parallel with user fetch. */
async function fetchTabData(
	params: { userId: number; cursor?: string; limit?: number },
	tab: ProfileTab,
): Promise<TabFetchResult<Thread | Post>> {
	const defaultLimit = await getCachedPageSize();
	const limit = params.limit ?? defaultLimit;

	const endpointMap: Record<ProfileTab, string> = {
		threads: `/api/v1/users/${params.userId}/threads`,
		posts: `/api/v1/users/${params.userId}/posts`,
		digest: `/api/v1/users/${params.userId}/digest`,
	};

	// Only digest has graceful fallback — threads/posts failures should propagate
	// (matching pre-refactor behavior where only digest had try/catch)
	if (tab === "digest") {
		try {
			const res = await forumApi.getCursor<Thread | Post>(endpointMap[tab], {
				limit,
				cursor: params.cursor,
			});
			return {
				ok: true,
				items: res.data,
				nextCursor: res.meta.nextCursor,
				prevCursor: params.cursor ?? null,
				total: 0,
			};
		} catch {
			return { ...emptyPage(), ok: false };
		}
	}

	const res = await forumApi.getCursor<Thread | Post>(endpointMap[tab], {
		limit,
		cursor: params.cursor,
	});
	return {
		ok: true,
		items: res.data,
		nextCursor: res.meta.nextCursor,
		prevCursor: params.cursor ?? null,
		total: 0,
	};
}
