import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";
import { NextResponse } from "next/server";

function csrfCheck(request: Request) {
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}
	return null;
}

function notAuthenticated() {
	return NextResponse.json(
		{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
		{ status: 401 },
	);
}

function internalError(label: string, err: unknown) {
	console.error(`[moderation/posts/[id]/route] ${label}:`, err);
	return NextResponse.json(
		{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
		{ status: 500 },
	);
}

/**
 * DELETE /api/v1/moderation/posts/:id
 * Delete a post (Mod+ only)
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const csrfError = csrfCheck(request);
	if (csrfError) return csrfError;

	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) return notAuthenticated();

	try {
		const result = await forumApi.deleteAuth(`/api/v1/moderation/posts/${id}`, {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		return internalError("forumApi.deleteAuth error", err);
	}
}

/**
 * PATCH /api/v1/moderation/posts/:id
 * Edit a post (Mod+ only)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const csrfError = csrfCheck(request);
	if (csrfError) return csrfError;

	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) return notAuthenticated();

	try {
		const body = await request.json();
		const result = await forumApi.patchAuth(`/api/v1/moderation/posts/${id}`, body, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) return forumApiErrorToProxyResponse(err);
		return internalError("forumApi.patchAuth error", err);
	}
}
