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

import { ForumApiError, forumApi } from "@/lib/forum-api";

/**
 * Get client IP from request headers.
 * Priority: X-Forwarded-For (first IP) > X-Real-IP > fallback to empty string.
 */
async function getClientIP(): Promise<string> {
	const h = await headers();

	// X-Forwarded-For may contain multiple IPs; take the first (client)
	const xff = h.get("x-forwarded-for");
	if (xff) {
		const firstIP = xff.split(",")[0]?.trim();
		if (firstIP) return firstIP;
	}

	// Fallback to X-Real-IP
	const realIP = h.get("x-real-ip");
	if (realIP) return realIP;

	// If no IP found, return empty string (Worker will reject if needed)
	return "";
}

export async function registerUser(
	username: string,
	password: string,
	email?: string,
): Promise<{ success: true } | { error: string }> {
	try {
		const clientIP = await getClientIP();
		await forumApi.postWithIP("/api/v1/auth/register", { username, password, email }, clientIP);
		return { success: true };
	} catch (error) {
		if (error instanceof ForumApiError) return { error: error.code };
		return { error: "INTERNAL_ERROR" };
	}
}
