// Proxy route: GET/DELETE /api/v1/messages/:id
import { getWorkerJwt } from "@/lib/forum-auth";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const { id } = await params;
		const result = await forumApi.getAuth<unknown>(`/api/v1/messages/${id}`, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const { id } = await params;
		const result = await forumApi.deleteAuth<unknown>(`/api/v1/messages/${id}`, undefined, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
