// Proxy route: GET /api/v1/posting-permission
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function GET() {
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

	try {
		const result = await forumApi.getAuth<unknown>("/api/v1/posting-permission", jwt);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[posting-permission/route] forumApi.getAuth error:", err);
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
