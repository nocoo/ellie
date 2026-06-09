// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id, /users/:id/threads, /users/:id/posts, /users/:id/digest).

import "server-only";

import type {
	PostThreadSummary,
	PublicUser,
	Thread,
	User,
	UserPostHistoryItem,
} from "@ellie/types";
import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCachedForumList, getCachedPageSize } from "@/lib/forum-cache";
import { emptyPage, type PaginatedResult } from "@/viewmodels/shared/pagination";
import { isUserPostHistoryItem, type ProfileTab, resolveTab } from "./user-profile";

/**
 * Lookup map from forumId → forum display name, built once at load time so
 * each profile-tab row component can resolve the board chip without firing
 * its own request. The full forum list is itself cached upstream by
 * `getCachedForumList()`, so this adds a single in-render reduce.
 */
export type ForumNameMap = Readonly<Record<number, string>>;

/**
 * Discriminator for the posts tab response shape:
 * - `"history"`: Worker returned `UserPostHistoryItem[]` ({ post, thread })
 *   — the new shape that supports rendering forum-list-style rows directly.
 * - `"legacy"`: Worker returned the old `Post[]` shape (no joined thread
 *   columns). The page must NOT cast or N+1-fetch; it should render a
 *   "backend upgrade pending" notice and suppress pagination, so users on
 *   a partially-deployed environment see a clear explanation instead of
 *   a runtime TypeError or a fake row.
 */
export type PostsShape = "history" | "legacy";

export interface UserProfileData {
	user: User;
	tab: ProfileTab;
	threads: PaginatedResult<Thread>;
	posts: PaginatedResult<UserPostHistoryItem>;
	digest: PaginatedResult<Thread>;
	/**
	 * Discriminates the response from `/api/v1/users/:id/posts`. `legacy` means
	 * the deployed Worker hasn't been upgraded to return `{ post, thread }`
	 * yet; in that state `posts` is always `emptyPage()` and pagination is
	 * suppressed regardless of the user's actual reply count.
	 */
	postsShape: PostsShape;
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

	// Merge tab results with user-derived totals (only when fetch succeeded
	// AND the shape matches what the UI expects).
	const totalMap: Record<ProfileTab, number> = {
		threads: user.threads,
		posts: user.posts,
		digest: user.digestPosts,
	};
	const postsShape: PostsShape =
		tab === "posts" && "postsShape" in tabResult && tabResult.postsShape
			? tabResult.postsShape
			: "history";
	// In legacy mode the worker hasn't been upgraded; suppress total so the
	// pagination UI doesn't claim there are pages the user can't reach. The
	// accompanying UserPostsTab notice explains what the user is seeing.
	const showUserTotal = tabResult.ok && !(tab === "posts" && postsShape === "legacy");
	const total = showUserTotal ? totalMap[tab] : 0;
	const tabPage: PaginatedResult<Thread | UserPostHistoryItem> = {
		items: tabResult.items,
		nextCursor: tabResult.nextCursor,
		prevCursor: tabResult.prevCursor,
		total,
	};

	return {
		user,
		tab,
		threads: tab === "threads" ? (tabPage as PaginatedResult<Thread>) : emptyPage(),
		posts: tab === "posts" ? (tabPage as PaginatedResult<UserPostHistoryItem>) : emptyPage(),
		digest: tab === "digest" ? (tabPage as PaginatedResult<Thread>) : emptyPage(),
		postsShape,
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

type TabFetchResult<T> = PaginatedResult<T> & {
	ok: boolean;
	/** Only set when fetching the posts tab. */
	postsShape?: PostsShape;
};

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

	// posts — Worker SHOULD return UserPostHistoryItem ({ post, thread }), but
	// we runtime-check before trusting that contract. A partially-deployed
	// environment that still returns plain `Post[]` would otherwise crash at
	// render with "Cannot read properties of undefined (reading 'createdAt')".
	const res = await forumApi.getCursor<unknown>(endpointMap[tab], {
		limit,
		cursor: params.cursor,
	});
	const rawItems = Array.isArray(res.data) ? res.data : [];
	// Empty response is ambiguous (could be either shape with 0 items) — treat
	// as "history" so we don't pessimize the normal "user has zero replies"
	// case. Only flip to legacy when we actually see a non-history item.
	const allHistoryShape =
		rawItems.length === 0 || rawItems.every((it) => isUserPostHistoryItem(it));
	if (!allHistoryShape) {
		// Suppress items, cursors and total — UserPostsTab will render a
		// "backend upgrade pending" notice in this branch.
		return {
			...emptyPage(),
			ok: true,
			postsShape: "legacy",
		};
	}
	// Filter out any individual malformed item (defense-in-depth) even when
	// the overall shape passes — keeps render purely on valid data.
	const items: UserPostHistoryItem[] = [];
	for (const it of rawItems) {
		if (isUserPostHistoryItem(it)) items.push(it);
	}
	return {
		ok: true,
		items,
		nextCursor: res.meta.nextCursor,
		prevCursor: params.cursor ?? null,
		total: 0,
		postsShape: "history",
	};
}

// Re-export PostThreadSummary so consumers in this slice don't need a
// separate @ellie/types import path.
export type { PostThreadSummary };
