import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

/**
 * POST /api/v1/moderation/users/:id/unban
 * Unban a user (Admin/SuperMod only)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
		const result = await forumApi.postAuth(`/api/v1/moderation/users/${id}/unban`, {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		const message = err instanceof Error ? err.message : "Internal server error";
		console.error("[moderation/users/[id]/unban/route] forumApi.postAuth error:", err);
		return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
	}
}
