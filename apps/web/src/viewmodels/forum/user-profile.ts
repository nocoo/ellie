// viewmodels/forum/user-profile.ts — User profile page ViewModel
// Ref: 04d §用户主页 — user info + thread/post history

import type { Repositories } from "@ellie/repositories";
import type { PaginatedResult } from "@ellie/repositories";
import type { Post, Thread, User } from "@ellie/types";
import { UserRole, UserStatus } from "@ellie/types";

export type ProfileTab = "threads" | "posts";

export interface UserProfileData {
	user: User;
	roleLabel: string;
	statusLabel: string;
}

/**
 * Map UserRole to display label.
 * Pure function, exported for testing.
 */
export function getUserRoleLabel(role: UserRole): string {
	switch (role) {
		case UserRole.Admin:
			return "Admin";
		case UserRole.SuperMod:
			return "Super Moderator";
		case UserRole.Mod:
			return "Moderator";
		case UserRole.User:
			return "Member";
	}
}

/**
 * Map UserStatus to display label.
 * Pure function, exported for testing.
 */
export function getUserStatusLabel(status: UserStatus): string {
	switch (status) {
		case UserStatus.Active:
			return "Active";
		case UserStatus.Banned:
			return "Banned";
		case UserStatus.Archived:
			return "Archived";
	}
}

/**
 * Fetch user profile data.
 */
export async function fetchUserProfile(
	repos: Repositories,
	userId: number,
): Promise<UserProfileData | null> {
	const user = await repos.users.getById(userId);
	if (!user) return null;

	return {
		user,
		roleLabel: getUserRoleLabel(user.role),
		statusLabel: getUserStatusLabel(user.status),
	};
}

/**
 * Fetch user's thread history (paginated).
 */
export async function fetchUserThreads(
	repos: Repositories,
	userId: number,
	options: { cursor?: string; direction?: "forward" | "backward"; limit?: number } = {},
): Promise<PaginatedResult<Thread>> {
	return repos.threads.list({
		authorId: userId,
		sort: "newest",
		cursor: options.cursor,
		direction: options.direction,
		limit: options.limit ?? 20,
	});
}

/**
 * Fetch user's post/reply history (paginated).
 */
export async function fetchUserPosts(
	repos: Repositories,
	userId: number,
	options: { cursor?: string; direction?: "forward" | "backward"; limit?: number } = {},
): Promise<PaginatedResult<Post>> {
	return repos.posts.list({
		authorId: userId,
		cursor: options.cursor,
		direction: options.direction,
		limit: options.limit ?? 20,
	});
}
