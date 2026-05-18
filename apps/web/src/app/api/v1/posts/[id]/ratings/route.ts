// Proxy route: GET /api/v1/posts/:id/ratings
// Browser → Next.js → Worker (list active post ratings; docs/22 §6.3)
//
// Optional auth: the Worker handler uses `optionalAuthVerified` to decide
// per-row `canRevoke` (Admin/SuperMod only). We mirror that here — try to
// acquire the session JWT but fall back to an anonymous call if missing
// or broken, so the popover still renders aggregate + reasons for
// public/unverified visitors.

import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	let jwt: string | null = null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		// Don't fail rating-list rendering because the session layer broke.
		// Anonymous Worker call will still return aggregate + items with
		// canRevoke=false for every row.
		console.warn("[posts/[id]/ratings/route] getWorkerJwt threw, falling back to anonymous:", err);
		jwt = null;
	}

	try {
		const path = `/api/v1/posts/${id}/ratings`;
		const result = jwt
			? await forumApi.getAuth<unknown>(path, jwt)
			: await forumApi.get<unknown>(path);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[posts/[id]/ratings/route] forumApi error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
