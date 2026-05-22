import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: GET/POST /api/v1/messages
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[messages/route] getWorkerJwt error:", err);
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
		const url = new URL(request.url);
		const result = await forumApi.getAuth<unknown>(
			"/api/v1/messages",
			jwt,
			Object.fromEntries(url.searchParams),
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[messages/route] forumApi.getAuth error:", err);
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
		console.error("[messages/route] getWorkerJwt error:", err);
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
		const result = await forumApi.postAuth<unknown>("/api/v1/messages", body, jwt, client);
		return NextResponse.json(result, { status: 201 });
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[messages/route] forumApi.postAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
