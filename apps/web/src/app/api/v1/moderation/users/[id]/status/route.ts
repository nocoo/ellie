import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/moderation/users/:id/status
 * Get user status for moderation (Admin/SuperMod only)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const result = await forumApi.getAuth(`/api/v1/moderation/users/${id}/status`, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[moderation/users/[id]/status/route] forumApi.getAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
