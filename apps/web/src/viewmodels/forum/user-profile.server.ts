// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id, /users/:id/threads, /users/:id/posts, /users/:id/digest).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCachedForumList, getCachedPageSize } from "@/lib/forum-cache";
import type {
	PostThreadSummary,
	PublicUser,
	Thread,
	User,
	UserPostHistoryItem,
} from "@ellie/types";
import { type ProfileTab, resolveTab } from "./user-profile";

import { type PaginatedResult, emptyPage } from "@/viewmodels/shared/pagination";

/**
 * Lookup map from forumId → forum display name, built once at load time so
 * each profile-tab row component can resolve the board chip without firing
 * its own request. The full forum list is itself cached upstream by
 * `getCachedForumList()`, so this adds a single in-render reduce.
 */
export type ForumNameMap = Readonly<Record<number, string>>;

export interface UserProfileData {
	user: User;
	tab: ProfileTab;
	threads: PaginatedResult<Thread>;
	posts: PaginatedResult<UserPostHistoryItem>;
	digest: PaginatedResult<Thread>;
	/** forumId → name, scoped to whichever forums show up in this page's items. */
	forumsById: ForumNameMap;
}

export async function loadUserProfile(params: {
	userId: number;
	tab?: string;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<UserProfileData> {
	const tab = resolveTab(params.tab);

	// Parallel fetch: user profile + (page size → tab data) + forum-name map.
	// All three are independent — forum list is cached so this is effectively
	// free on warm renders and one extra request on cold renders.
	const [{ data: publicUser }, tabResult, forumsById] = await Promise.all([
		forumApi.get<PublicUser>(`/api/v1/users/${params.userId}`),
		fetchTabData(params, tab),
		loadForumNameMap(),
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
		posts: tab === "posts" ? (tabPage as PaginatedResult<UserPostHistoryItem>) : emptyPage(),
		digest: tab === "digest" ? (tabPage as PaginatedResult<Thread>) : emptyPage(),
		forumsById,
	};
}

/** Build a `forumId → name` map from the cached forum list. */
async function loadForumNameMap(): Promise<ForumNameMap> {
	const forums = await getCachedForumList();
	const map: Record<number, string> = {};
	for (const f of forums) {
		map[f.id] = f.name;
	}
	return map;
}

type TabFetchResult<T> = PaginatedResult<T> & { ok: boolean };

/** Fetch page size then tab-specific data. Runs in parallel with user fetch. */
async function fetchTabData(
	params: { userId: number; cursor?: string; limit?: number },
	tab: ProfileTab,
): Promise<TabFetchResult<Thread | UserPostHistoryItem>> {
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
			const res = await forumApi.getCursor<Thread>(endpointMap[tab], {
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

	if (tab === "threads") {
		const res = await forumApi.getCursor<Thread>(endpointMap[tab], {
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

	// posts — Worker returns UserPostHistoryItem ({ post, thread })
	const res = await forumApi.getCursor<UserPostHistoryItem>(endpointMap[tab], {
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

// Re-export PostThreadSummary so consumers in this slice don't need a
// separate @ellie/types import path.
export type { PostThreadSummary };
