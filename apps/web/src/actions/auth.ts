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
 * SECURITY: Only trusts platform-specific headers that cannot be spoofed:
 * - Cloudflare: CF-Connecting-IP (set by Cloudflare edge proxy)
 * - Generic reverse proxy: x-real-ip
 *
 * x-forwarded-for is ONLY used in development mode for local testing
 * convenience, as it can be spoofed by clients in production.
 *
 * In production without a trusted header, returns empty string so Worker
 * rejects the request (prevents rate limit bypass).
 */
async function getClientIP(): Promise<string> {
	const h = await headers();

	// Cloudflare sets CF-Connecting-IP to the real client IP
	const cfIP = h.get("cf-connecting-ip");
	if (cfIP) return cfIP;

	// Generic reverse proxy header
	const realIP = h.get("x-real-ip");
	if (realIP) return realIP;

	// SECURITY: Only allow x-forwarded-for fallback in development
	// In production, this header can be spoofed by clients
	if (process.env.NODE_ENV === "development") {
		const xff = h.get("x-forwarded-for");
		if (xff) {
			const firstIP = xff.split(",")[0]?.trim();
			if (firstIP) return firstIP;
		}
	}

	// No trusted IP found - Worker will reject rate-limited requests
	return "";
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
