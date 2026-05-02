// Proxy route: POST /api/v1/users/me/email/request-code
//
// Browser → Next.js → Worker. Forwards the request body verbatim — including
// the `cf_turnstile_token` Cloudflare Turnstile widget token captured by the
// EmailVerificationCard. The Worker side enforces captcha (§7.2.1, fail-closed)
// and the docs/17 §5.4 flat payload is passed through unmodified for the
// global write-button dialog flow.

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
		// Explicitly project to `EmailRequestCodeBody` — never spread the raw
		// body. This guarantees only the fields the Worker contract expects
		// reach the upstream, regardless of what the caller appends. Runtime
		// validation (string types, captcha verification) stays on the Worker.
		const body: EmailRequestCodeBody = {
			email: raw.email as string,
			cf_turnstile_token: raw.cf_turnstile_token as string,
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
