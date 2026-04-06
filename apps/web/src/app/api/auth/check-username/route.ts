/**
 * Next.js API Route — proxies check-username to Worker with Key A.
 *
 * Ref: docs/04g-user-auth.md §6
 */

import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

/**
 * Get client IP from request headers.
 * Priority: X-Forwarded-For (first IP) > X-Real-IP > fallback to empty string.
 */
function getClientIP(request: Request): string {
	// X-Forwarded-For may contain multiple IPs; take the first (client)
	const xff = request.headers.get("x-forwarded-for");
	if (xff) {
		const firstIP = xff.split(",")[0]?.trim();
		if (firstIP) return firstIP;
	}

	// Fallback to X-Real-IP
	const realIP = request.headers.get("x-real-ip");
	if (realIP) return realIP;

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
