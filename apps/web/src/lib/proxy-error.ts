// Shared helpers for Next.js proxy routes that forward authenticated calls to
// the Worker (apps/web/src/app/api/v1/...).
//
// The default proxy pattern catches `ForumApiError` and re-emits a wrapped
// `{ error: { code, message } }` body. That collapses any non-wrapped Worker
// payload — most importantly the docs/17 §5.4 EmailNotVerifiedPayload, whose
// flat shape (`{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }`)
// is the string the web fetch wrapper uses to dispatch the verification dialog.
// If the proxy collapses it, every dialog trigger silently breaks.
//
// `forumApiErrorToProxyResponse` checks the captured `rawBody` for the §5.4
// flat discriminator and forwards it verbatim; otherwise it falls back to the
// wrapped `{ error: { code, message } }` shape used by every other proxy.

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { NextResponse } from "next/server";
import type { ForumApiError } from "./forum-api";

/** Type guard for an object that looks like the §5.4 flat payload on the wire. */
export function isEmailNotVerifiedPayload(body: unknown): boolean {
	if (body == null || typeof body !== "object") return false;
	const obj = body as Record<string, unknown>;
	if (obj.error !== EMAIL_NOT_VERIFIED_PAYLOAD.error) return false;
	// Reviewer guard: also require the §5.4 shape's fingerprint fields so a
	// future malformed body that just happens to set `error: "EMAIL_NOT_VERIFIED"`
	// at the top level cannot be verbatim-forwarded with missing dialog/redirect.
	if (typeof obj.message !== "string") return false;
	if (typeof obj.redirect_to !== "string") return false;
	if (obj.dialog == null || typeof obj.dialog !== "object") return false;
	return true;
}

/**
 * Convert a thrown `ForumApiError` into a `NextResponse` suitable for a Next.js
 * proxy route. Forwards the docs/17 §5.4 flat payload verbatim; otherwise
 * collapses to the wrapped `{ error: { code, message } }` shape.
 */
export function forumApiErrorToProxyResponse(err: ForumApiError): NextResponse {
	if (isEmailNotVerifiedPayload(err.rawBody)) {
		// Forward the body the Worker actually sent, preserving `dialog` /
		// `redirect_to`. The Worker's status is 403 in this case (§5.4).
		return NextResponse.json(err.rawBody as Record<string, unknown>, { status: err.status });
	}
	return NextResponse.json(
		{ error: { code: err.code, message: err.message } },
		{ status: err.status },
	);
}
