// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Calls Worker API (GET /api/v1/users/:id).
// Worker v1 has no authorId filter on threads/posts, so history tabs return empty.

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

export async function loadUserProfile(params: {
	userId: number;
	tab?: string;
	threadCursor?: string;
	postCursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<UserProfileData> {
	const tab = resolveTab(params.tab);

	const { data: publicUser } = await forumApi.get<PublicUser>(`/api/v1/users/${params.userId}`);
	const user = publicUserToUser(publicUser);

	// Worker v1 does not support authorId filter on threads/posts.
	// Return empty paginated results — thread/post history is unavailable.
	return {
		user,
		tab,
		threads: EMPTY_PAGE as PaginatedResult<Thread>,
		posts: EMPTY_PAGE as PaginatedResult<Post>,
	};
}
