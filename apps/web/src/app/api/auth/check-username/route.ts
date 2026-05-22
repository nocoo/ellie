/**
 * Next.js API Route — proxies check-username to Worker with Key A.
 *
 * Ref: docs/04g-user-auth.md §6
 */

import { extractClientIp } from "@/lib/client-ip";
import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const username = url.searchParams.get("username");
	if (!username) {
		return NextResponse.json({ available: false, reason: "invalid" });
	}

	try {
		const clientIP = extractClientIp(request);
		const clientUA = request.headers.get("User-Agent") || undefined;
		const result = await forumApi.getWithIP<{ available: boolean; reason?: string }>(
			"/api/v1/auth/check-username",
			{ username },
			clientIP,
			clientUA,
		);
		return NextResponse.json(result.data);
	} catch {
		return NextResponse.json({ available: false, reason: "error" }, { status: 500 });
	}
}
