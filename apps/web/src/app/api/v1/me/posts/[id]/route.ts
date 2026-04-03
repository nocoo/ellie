import { getWorkerJwt } from "@/lib/forum-auth";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

/**
 * DELETE /api/v1/me/posts/:id
 * Delete own post (author only)
 */
export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
	}

	try {
		const result = await forumApi.deleteAuth(`/api/v1/me/posts/${id}`, {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: err.code }, { status: err.status });
		}
		return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
	}
}

/**
 * PATCH /api/v1/me/posts/:id
 * Edit own post (author only)
 */
export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
	}

	try {
		const body = await request.json();
		const result = await forumApi.patchAuth(`/api/v1/me/posts/${id}`, body, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: err.code }, { status: err.status });
		}
		return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
	}
}
