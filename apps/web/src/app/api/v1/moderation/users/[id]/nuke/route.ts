import { getWorkerJwt } from "@/lib/forum-auth";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

/**
 * POST /api/v1/moderation/users/:id/nuke
 * Ban user and delete all their content (Admin/SuperMod only)
 */
export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const jwt = await getWorkerJwt();
	if (!jwt) {
		return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
	}

	try {
		const result = await forumApi.postAuth(`/api/v1/moderation/users/${id}/nuke`, {}, jwt);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: err.code }, { status: err.status });
		}
		return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
	}
}
