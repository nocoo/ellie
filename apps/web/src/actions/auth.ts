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
 * - Railway: X-Envoy-External-Address (set by Railway's Envoy proxy)
 * - Vercel: x-real-ip (set by Vercel's edge)
 * - Cloudflare: CF-Connecting-IP (when using Cloudflare in front)
 *
 * x-forwarded-for is ONLY used in development mode for local testing
 * convenience, as it can be spoofed by clients in production.
 *
 * In production without a trusted header, returns empty string so Worker
 * rejects the request (prevents rate limit bypass).
 */
async function getClientIP(): Promise<string> {
	const h = await headers();

	// Railway sets X-Envoy-External-Address to the real client IP
	const envoyIP = h.get("x-envoy-external-address");
	if (envoyIP) return envoyIP;

	// Vercel sets x-real-ip to the real client IP
	const realIP = h.get("x-real-ip");
	if (realIP) return realIP;

	// Cloudflare sets CF-Connecting-IP (if using Cloudflare in front)
	const cfIP = h.get("cf-connecting-ip");
	if (cfIP) return cfIP;

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
