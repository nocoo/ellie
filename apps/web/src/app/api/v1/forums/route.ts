// Proxy route: GET /api/v1/forums
// Browser → Next.js → Worker (list forums)
//
// The Worker endpoint (`apps/worker/src/handlers/forum.ts:list`) accepts an
// optional bearer token: when present, it filters by per-user forum
// visibility; when absent, it returns the public-visibility set. We mirror
// that here — try to get the session JWT, but if it is missing or the
// session helper throws (e.g. malformed session cookie / missing
// AUTH_SECRET in dev), fall back to the public listing rather than 500ing
// the move-thread dialog.

import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

export async function GET() {
	let jwt: string | null = null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		// Don't fail the public forum list because the session layer broke.
		// Log and degrade to anonymous; Worker will still return public forums.
		console.warn("[forums/route] getWorkerJwt threw, falling back to public:", err);
		jwt = null;
	}

	try {
		const result = jwt
			? await forumApi.getAuth<unknown>("/api/v1/forums", jwt)
			: await forumApi.getAll<unknown>("/api/v1/forums");
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		console.error("[forums/route] forumApi error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
