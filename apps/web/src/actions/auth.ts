"use server";

/**
 * Server Actions for forum user auth.
 *
 * registerUser() calls Worker register endpoint via forum-api.
 * Key A is injected server-side, never exposed to browser.
 *
 * Ref: docs/04g-user-auth.md §3.4
 */

import { ForumApiError, forumApi } from "@/lib/forum-api";

export async function registerUser(
	username: string,
	password: string,
	email?: string,
): Promise<{ success: true } | { error: string }> {
	try {
		await forumApi.post("/api/v1/auth/register", { username, password, email });
		return { success: true };
	} catch (error) {
		if (error instanceof ForumApiError) return { error: error.code };
		return { error: "INTERNAL_ERROR" };
	}
}
