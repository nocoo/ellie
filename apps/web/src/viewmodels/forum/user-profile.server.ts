// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id, /users/:id/threads, /users/:id/posts, /users/:id/digest).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
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

	let threads: PaginatedResult<Thread> = emptyPage();
	let posts: PaginatedResult<Post> = emptyPage();
	let digest: PaginatedResult<Thread> = emptyPage();

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
	} else if (tab === "posts") {
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
	} else if (tab === "digest") {
		const res = await forumApi.getCursor<Thread>(`/api/v1/users/${params.userId}/digest`, {
			limit,
			cursor: params.cursor,
		});
		digest = {
			items: res.data,
			nextCursor: res.meta.nextCursor,
			prevCursor: params.cursor ?? null,
			total: user.digestPosts,
		};
	}

	return { user, tab, threads, posts, digest };
}
