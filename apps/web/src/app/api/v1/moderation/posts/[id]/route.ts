import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
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

/**
 * DELETE /api/v1/moderation/posts/:id
 * Delete a post (Mod+ only)
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const csrfError = csrfCheck(request);
	if (csrfError) return csrfError;

	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
	}

	try {
		const result = await forumApi.deleteAuth(`/api/v1/moderation/posts/${id}`, {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: err.code }, { status: err.status });
		}
		return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
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
	if (!jwt) {
		return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const result = await forumApi.patchAuth(`/api/v1/moderation/posts/${id}`, body, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: err.code }, { status: err.status });
		}
		return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
	}
}
