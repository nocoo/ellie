import { ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: POST /api/v1/threads
// Browser → Next.js → Worker (create thread)
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[threads/route] getWorkerJwt error:", err);
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

	try {
		const body = await request.json();
		const result = await forumApi.postAuth<unknown>("/api/v1/threads", body, jwt);
		return NextResponse.json(result, { status: 201 });
	} catch (err) {
		console.error("[threads/route] forumApi.postAuth error:", err);
		if (err instanceof ForumApiError) {
			return NextResponse.json(
				{ error: { code: err.code, message: err.message } },
				{ status: err.status },
			);
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
