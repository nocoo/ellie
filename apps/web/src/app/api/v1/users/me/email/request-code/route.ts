// Proxy route: POST /api/v1/users/me/email/request-code
//
// Browser → Next.js → Worker. Forwards the request body verbatim. Client-side
// Cap captcha gates the send button; the token is NOT forwarded to the Worker
// (same model as login/register). The Worker still has JWT auth + 60s throttle +
// 5 attempt limit + HMAC code signing as abuse protection.

import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import type { EmailRequestCodeBody } from "@ellie/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
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
		console.error("[users/me/email/request-code/route] getWorkerJwt error:", err);
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
		const raw = (await request.json()) as Partial<Record<string, unknown>>;
		const body: EmailRequestCodeBody = {
			email: raw.email as string,
		};
		const result = await forumApi.postAuth<unknown>(
			"/api/v1/users/me/email/request-code",
			body,
			jwt,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[users/me/email/request-code/route] forumApi.postAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
