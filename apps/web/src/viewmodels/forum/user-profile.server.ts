// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id, /users/:id/threads, /users/:id/posts).

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import type { Post, PublicUser, Thread, User } from "@ellie/types";
import { type ProfileTab, resolveTab } from "./user-profile";

/** Matches PaginatedResult shape from @ellie/repositories */
interface PaginatedResult<T> {
	items: T[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export interface UserProfileData {
	user: User;
	tab: ProfileTab;
	threads: PaginatedResult<Thread>;
	posts: PaginatedResult<Post>;
}

const EMPTY_PAGE = { items: [], nextCursor: null, prevCursor: null, total: 0 };
const HISTORY_LIMIT = 20;

export async function loadUserProfile(params: {
	userId: number;
	tab?: string;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<UserProfileData> {
	const tab = resolveTab(params.tab);
	const limit = params.limit ?? HISTORY_LIMIT;

	const { data: publicUser } = await forumApi.get<PublicUser>(`/api/v1/users/${params.userId}`);
	const user = publicUserToUser(publicUser);

	let threads: PaginatedResult<Thread> = EMPTY_PAGE as PaginatedResult<Thread>;
	let posts: PaginatedResult<Post> = EMPTY_PAGE as PaginatedResult<Post>;

	if (tab === "threads") {
		const res = await forumApi.getCursor<Thread>(`/api/v1/users/${params.userId}/threads`, {
			limit,
			cursor: params.cursor,
		});
		threads = {
			items: res.data,
			nextCursor: res.meta.nextCursor,
			prevCursor: params.cursor ?? null,
			total: 0, // keyset pagination doesn't provide total
		};
	} else {
		const res = await forumApi.getCursor<Post>(`/api/v1/users/${params.userId}/posts`, {
			limit,
			cursor: params.cursor,
		});
		posts = {
			items: res.data,
			nextCursor: res.meta.nextCursor,
			prevCursor: params.cursor ?? null,
			total: 0,
		};
	}

	return { user, tab, threads, posts };
}
