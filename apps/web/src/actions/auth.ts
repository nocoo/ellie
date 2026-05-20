"use server";

/**
 * Server Actions for forum user auth.
 *
 * registerUser() calls Worker register endpoint via forum-api.
 * Key A is injected server-side, never exposed to browser.
 *
 * Ref: docs/04g-user-auth.md §3.4
 */

import { headers } from "next/headers";

import { extractClientIp } from "@/lib/client-ip";
import { ForumApiError, forumApi } from "@/lib/forum-api";

async function getClientIP(): Promise<string> {
	const h = await headers();
	return extractClientIp(h);
}

export async function registerUser(
	username: string,
	password: string,
	email: string,
	profile?: Record<string, unknown>,
): Promise<{ success: true } | { error: string }> {
	try {
		const clientIP = await getClientIP();
		await forumApi.postWithIP(
			"/api/v1/auth/register",
			{ username, password, email, profile },
			clientIP,
		);
		return { success: true };
	} catch (error) {
		if (error instanceof ForumApiError) return { error: error.code };
		return { error: "INTERNAL_ERROR" };
	}
}
