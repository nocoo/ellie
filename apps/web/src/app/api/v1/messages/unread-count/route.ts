import { ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: GET /api/v1/messages/unread-count
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function GET() {
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const result = await forumApi.getAuth<unknown>("/api/v1/messages/unread-count", jwt);
		return NextResponse.json(result);
	} catch (err) {
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
