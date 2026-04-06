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
 *
 * On Vercel, x-real-ip is set by Vercel and contains the client's real IP.
 * This header is NOT spoofable because Vercel overwrites any incoming value.
 *
 * We prioritize x-real-ip over x-forwarded-for because x-forwarded-for
 * can contain multiple IPs and the first one could be spoofed by the client.
 */
async function getClientIP(): Promise<string> {
	const h = await headers();

	// Vercel sets x-real-ip to the real client IP (not spoofable)
	const realIP = h.get("x-real-ip");
	if (realIP) return realIP;

	// Fallback: x-forwarded-for (less reliable, first IP could be spoofed)
	// Only used when not on Vercel (e.g., local development)
	const xff = h.get("x-forwarded-for");
	if (xff) {
		const firstIP = xff.split(",")[0]?.trim();
		if (firstIP) return firstIP;
	}

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
