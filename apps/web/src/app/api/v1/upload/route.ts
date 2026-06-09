// Proxy route: POST /api/v1/upload (multipart/form-data)
// Forwards avatar uploads to Worker with JWT authentication
import "server-only";

import { NextResponse } from "next/server";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse, isEmailNotVerifiedPayload } from "@/lib/proxy-error";

function getWorkerUrl(): string {
	const url = process.env.WORKER_API_URL;
	if (!url) throw new Error("WORKER_API_URL environment variable is not set");
	return url.replace(/\/+$/, "");
}

function getApiKey(): string {
	const key = process.env.FORUM_API_KEY;
	if (!key) throw new Error("FORUM_API_KEY environment variable is not set");
	return key;
}

export async function POST(request: Request) {
	// CSRF protection
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
		console.error("[upload/route] getWorkerJwt error:", err);
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
		// Get the raw body as ArrayBuffer to preserve multipart boundary
		const body = await request.arrayBuffer();
		const contentType = request.headers.get("Content-Type");

		if (!contentType?.includes("multipart/form-data")) {
			return NextResponse.json(
				{ error: { code: "INVALID_REQUEST", message: "Content-Type must be multipart/form-data" } },
				{ status: 400 },
			);
		}

		// Forward to Worker with correct headers
		const workerUrl = `${getWorkerUrl()}/api/v1/upload`;
		const res = await fetch(workerUrl, {
			method: "POST",
			headers: {
				"X-API-Key": getApiKey(),
				Authorization: `Bearer ${jwt}`,
				"Content-Type": contentType, // Must include boundary
			},
			body,
		});

		// Parse Worker response
		const text = await res.text();
		let json: Record<string, unknown>;
		try {
			json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
		} catch {
			console.error("[upload/route] Failed to parse Worker response:", text.slice(0, 200));
			return NextResponse.json(
				{ error: { code: "INTERNAL_ERROR", message: "Failed to parse Worker response" } },
				{ status: 500 },
			);
		}

		if (!res.ok) {
			// docs/17 §5.4 EmailNotVerifiedPayload uses a flat shape
			// (`{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }`).
			// Forward verbatim so the browser's email-verification dialog
			// trigger (api-client → dispatchEmailNotVerified) still fires.
			if (isEmailNotVerifiedPayload(json)) {
				return NextResponse.json(json, { status: res.status });
			}
			const errorData = json.error as { code: string; message: string } | undefined;
			return NextResponse.json(
				{ error: errorData ?? { code: "UNKNOWN", message: `Worker returned ${res.status}` } },
				{ status: res.status },
			);
		}

		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[upload/route] fetch error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
