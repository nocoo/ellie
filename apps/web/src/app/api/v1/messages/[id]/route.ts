import { NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
// Proxy route: GET/DELETE /api/v1/messages/:id
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	const client: ClientContext = {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};

	try {
		const { id } = await params;
		const result = await forumApi.getAuth<unknown>(
			`/api/v1/messages/${id}`,
			jwt,
			undefined,
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[messages/[id]/route] forumApi.getAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	const client: ClientContext = {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};

	try {
		const { id } = await params;
		const result = await forumApi.deleteAuth<unknown>(
			`/api/v1/messages/${id}`,
			undefined,
			jwt,
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[messages/[id]/route] forumApi.deleteAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
