// Proxy route: POST /api/v1/users/me/email/verify
//
// Browser → Next.js → Worker. Body is `{ email, code }` only — the verify
// step is intentionally captcha-free per docs/17 §7.3 (a successful captcha
// was already burned at request-code time). docs/17 §5.4 flat payload is
// forwarded verbatim via `forumApiErrorToProxyResponse`.

import type { EmailVerifyCodeBody } from "@ellie/types";
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
		console.error("[users/me/email/verify/route] getWorkerJwt error:", err);
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
		// Explicitly project to `EmailVerifyCodeBody` — never spread the raw
		// body. The verify step is captcha-free per docs/17 §7.3; if a caller
		// (browser, malicious client, future bug) attaches `cf_turnstile_token`
		// or any other field, we MUST drop it here before forwarding to the
		// Worker. Runtime field validation stays on the Worker side.
		const body: EmailVerifyCodeBody = {
			email: raw.email as string,
			code: raw.code as string,
		};
		const result = await forumApi.postAuth<unknown>(
			"/api/v1/users/me/email/verify",
			body,
			jwt,
			client,
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[users/me/email/verify/route] forumApi.postAuth error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
