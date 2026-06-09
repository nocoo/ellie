// Proxy route: POST /api/v1/posts/:id/ratings/:ratingId/revoke
// Browser → Next.js → Worker (revoke a post rating; docs/22 §6.4)
//
// Worker returns 204 on success. We forward that as 204 with no body so
// browsers don't see a stray "{}" payload. ForumApiError is funneled
// through `forumApiErrorToProxyResponse` so the role/status gates
// (`FORBIDDEN_MOD_ONLY`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`) reach the
// client unchanged.

import { type NextRequest, NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string; ratingId: string }> },
) {
	// CSRF — mutating method must come from an allowed Origin.
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	let jwt: string | null = null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[posts/[id]/ratings/[ratingId]/revoke/route] getWorkerJwt error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	const { id, ratingId } = await params;

	const client: ClientContext = {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};

	try {
		await forumApi.postAuth<unknown>(
			`/api/v1/posts/${id}/ratings/${ratingId}/revoke`,
			{},
			jwt,
			client,
		);
		// Worker returns 204; pass through with no body.
		return new NextResponse(null, { status: 204 });
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[posts/[id]/ratings/[ratingId]/revoke/route] forumApi error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
