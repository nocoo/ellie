import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: POST /api/v1/messages/mark-all-read
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[messages/mark-all-read] getWorkerJwt error:", err);
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
		const result = await forumApi.postAuth<unknown>("/api/v1/messages/mark-all-read", {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[messages/mark-all-read] forumApi.postAuth error:", err);
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
