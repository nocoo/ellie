import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: GET & POST /api/v1/post-comments
// Browser → Next.js → Worker (list and create post comments)
import { getWorkerJwt } from "@/lib/forum-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const postId = url.searchParams.get("postId");

	if (!postId) {
		return NextResponse.json(
			{ error: { code: "INVALID_REQUEST", message: "postId is required" } },
			{ status: 400 },
		);
	}

	try {
		const result = await forumApi.get<unknown>(`/api/v1/post-comments?postId=${postId}`);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[post-comments/route] forumApi.get error:", err);
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

export async function POST(request: Request) {
	// CSRF protection
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
		console.error("[post-comments/route] getWorkerJwt error:", err);
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
		const result = await forumApi.postAuth<unknown>("/api/v1/post-comments", body, jwt);
		return NextResponse.json(result, { status: 201 });
	} catch (err) {
		console.error("[post-comments/route] forumApi.postAuth error:", err);
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
