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
function getClientIP(request: Request): string {
	// Railway sets X-Envoy-External-Address to the real client IP
	const envoyIP = request.headers.get("x-envoy-external-address");
	if (envoyIP) return envoyIP;

	// Vercel sets x-real-ip to the real client IP
	const realIP = request.headers.get("x-real-ip");
	if (realIP) return realIP;

	// Cloudflare sets CF-Connecting-IP (if using Cloudflare in front)
	const cfIP = request.headers.get("cf-connecting-ip");
	if (cfIP) return cfIP;

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
