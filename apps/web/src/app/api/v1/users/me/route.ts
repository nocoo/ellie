/**
 * Next.js API Route — proxies PATCH /api/v1/users/me to Worker with auth JWT.
 *
 * Used by ProfileEditDialog to update user profile.
 *
 * Worker errors are forwarded via `forumApiErrorToProxyResponse` so that the
 * docs/17 §5.4 flat `EMAIL_NOT_VERIFIED` payload (Worker returns 403 with
 * `{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }`) reaches the
 * browser verbatim with its original 403 status. Previously every Worker error
 * was collapsed into a wrapped `{ error: { code: <string> } }` body and
 * downgraded to 400, breaking the global verification dialog dispatch.
 */

import type { User } from "@ellie/types";
import { NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError } from "@/lib/forum-api";
import { authPatch } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

export async function PATCH(request: Request) {
	// CSRF protection
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	const client: ClientContext = {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return NextResponse.json(
			{ error: { code: "INVALID_BODY", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	try {
		const result = await authPatch<User>("/api/v1/users/me", body, client);

		if ("error" in result) {
			return NextResponse.json(
				{ error: { code: result.error, message: "Not authenticated" } },
				{ status: 401 },
			);
		}

		return NextResponse.json({ data: result.data, meta: result.meta });
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[users/me/route] authPatch error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
