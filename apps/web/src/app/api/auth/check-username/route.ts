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
 * On Vercel, x-real-ip is set by Vercel and contains the client's real IP.
 * This header is NOT spoofable because Vercel overwrites any incoming value.
 *
 * We prioritize x-real-ip over x-forwarded-for because x-forwarded-for
 * can contain multiple IPs and the first one could be spoofed by the client.
 */
function getClientIP(request: Request): string {
	// Vercel sets x-real-ip to the real client IP (not spoofable)
	const realIP = request.headers.get("x-real-ip");
	if (realIP) return realIP;

	// Fallback: x-forwarded-for (less reliable, first IP could be spoofed)
	// Only used when not on Vercel (e.g., local development)
	const xff = request.headers.get("x-forwarded-for");
	if (xff) {
		const firstIP = xff.split(",")[0]?.trim();
		if (firstIP) return firstIP;
	}

	// If no IP found, return empty string (Worker will reject if needed)
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
