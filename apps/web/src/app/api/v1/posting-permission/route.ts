// Proxy route: GET /api/v1/posting-permission

import { NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

export async function GET(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[posting-permission/route] getWorkerJwt error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Failed to get session" } },
			{ status: 500 },
		);
	}

	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	// Forward action query param to the Worker so content-switch checks
	// (allow_new_thread, allow_reply) match the actual write action.
	const action = new URL(request.url).searchParams.get("action");

	const client: ClientContext = {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};

	try {
		const result = await forumApi.getAuth<unknown>(
			"/api/v1/posting-permission",
			jwt,
			action ? { action } : undefined,
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[posting-permission/route] forumApi.getAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
