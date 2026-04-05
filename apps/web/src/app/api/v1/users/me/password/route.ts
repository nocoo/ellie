import { ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: POST /api/v1/users/me/password
// Browser → Next.js → Worker (change password)
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[users/me/password/route] getWorkerJwt error:", err);
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
		const result = await forumApi.postAuth<unknown>("/api/v1/users/me/password", body, jwt);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[users/me/password/route] forumApi.postAuth error:", err);
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
