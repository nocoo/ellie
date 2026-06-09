import { NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: GET & POST /api/v1/post-comments
// Browser → Next.js → Worker (list and create post comments)
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const postId = url.searchParams.get("postId");
	const limit = url.searchParams.get("limit");

	if (!postId) {
		return NextResponse.json(
			{ error: { code: "INVALID_REQUEST", message: "postId is required" } },
			{ status: 400 },
		);
	}

	try {
		// Use typed searchParams form — never string-concat untrusted input into the URL.
		// `forumApi.get` skips undefined/null/empty values, so an absent `limit`
		// is simply omitted rather than forwarded as `limit=`.
		const result = await forumApi.get<unknown>("/api/v1/post-comments", { postId, limit });
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[post-comments/route] forumApi.get error:", err);
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
		const client: ClientContext = {
			ip: extractClientIp(request) || undefined,
			userAgent: request.headers.get("User-Agent") || undefined,
		};
		const body = await request.json();
		const result = await forumApi.postAuth<unknown>("/api/v1/post-comments", body, jwt, client);
		return NextResponse.json(result, { status: 201 });
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[post-comments/route] forumApi.postAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
