// Proxy route: POST /api/v1/users/me/email/correct
//
// Browser → Next.js → Worker. One-shot pre-verification email correction —
// allowed once while `email_verified_at = 0 AND email_changed_at = 0`. The
// Worker writes both `email` and `email_normalized` and stamps
// `email_changed_at`, then drops any pending KV verification code that was
// HMAC-bound to the previous address.
//
// No captcha is required here. The endpoint is JWT-gated and naturally
// throttled by the one-shot guard — a caller can flip the address at most
// once per account before re-verifying.

import { NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

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
		console.error("[users/me/email/correct/route] getWorkerJwt error:", err);
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
		const raw = (await request.json()) as Partial<Record<string, unknown>>;
		// Project explicitly — never spread. The Worker only consumes `email`;
		// drop everything else here so a future client field addition cannot
		// accidentally leak through.
		const body = { email: raw.email as string };
		const result = await forumApi.postAuth<unknown>(
			"/api/v1/users/me/email/correct",
			body,
			jwt,
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[users/me/email/correct/route] forumApi.postAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
