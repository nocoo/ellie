// viewmodels/forum/user-profile.server.ts — Server-only data loader for user profile
// Ref: 04d §UserProfile — user info + per-tab thread/post history

import { type PaginatedResult, createRepositories } from "@ellie/repositories";
import type { Post, Thread, User } from "@ellie/types";
import { type ProfileTab, resolveTab } from "./user-profile";

export interface UserProfileData {
	user: User;
	tab: ProfileTab;
	threads: PaginatedResult<Thread>;
	posts: PaginatedResult<Post>;
}

export async function loadUserProfile(params: {
	userId: number;
	tab?: string;
	threadCursor?: string;
	postCursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<UserProfileData> {
	const repos = createRepositories();
	const limit = params.limit ?? 20;
	const direction = params.direction ?? "forward";
	const tab = resolveTab(params.tab);

	const user = await repos.users.getById(params.userId);
	if (!user) {
		throw new Error("User not found");
	}

	// Parallel load both tabs' data
	const [threadResult, postResult] = await Promise.all([
		repos.threads.list({
			authorId: params.userId,
			cursor: params.threadCursor,
			direction,
			limit,
		}) as Promise<PaginatedResult<Thread>>,
		repos.posts.list({
			authorId: params.userId,
			cursor: params.postCursor,
			direction,
			limit,
		}) as Promise<PaginatedResult<Post>>,
	]);

	return {
		user,
		tab,
		threads: threadResult,
		posts: postResult,
	};
}
