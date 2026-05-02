import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

/**
 * PATCH /api/v1/moderation/threads/:id/highlight
 * Set thread highlight style (Mod+ only)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const body = await request.json();
		const result = await forumApi.patchAuth(
			`/api/v1/moderation/threads/${id}/highlight`,
			body,
			jwt,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[moderation/threads/[id]/highlight/route] forumApi.patchAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
