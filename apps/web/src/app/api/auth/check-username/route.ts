/**
 * Next.js API Route — proxies check-username to Worker with Key A.
 *
 * Ref: docs/04g-user-auth.md §6
 */

import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

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
function getClientIP(request: Request): string {
	// Cloudflare sets CF-Connecting-IP to the real client IP
	const cfIP = request.headers.get("cf-connecting-ip");
	if (cfIP) return cfIP;

	// Generic reverse proxy header
	const realIP = request.headers.get("x-real-ip");
	if (realIP) return realIP;

	// SECURITY: Only allow x-forwarded-for fallback in development
	// In production, this header can be spoofed by clients
	if (process.env.NODE_ENV === "development") {
		const xff = request.headers.get("x-forwarded-for");
		if (xff) {
			const firstIP = xff.split(",")[0]?.trim();
			if (firstIP) return firstIP;
		}
	}

	// No trusted IP found - Worker will reject rate-limited requests
	return "";
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const username = url.searchParams.get("username");
	if (!username) {
		return NextResponse.json({ available: false, reason: "invalid" });
	}

	try {
		const clientIP = getClientIP(request);
		const result = await forumApi.getWithIP<{ available: boolean; reason?: string }>(
			"/api/v1/auth/check-username",
			{ username },
			clientIP,
		);
		return NextResponse.json(result.data);
	} catch {
		return NextResponse.json({ available: false, reason: "error" }, { status: 500 });
	}
}
