// api/v1/posts/[id]/route.ts — Post delete endpoint
// Ref: 04b §API 路由边界 — /api/v1/posts/:id (delete: auth)

import { errorResponse, getRepos, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/posts/:id — Delete a post
 *
 * Requires auth (Phase 2: checked via session + ownership/mod role).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
	const { id } = await params;
	const parsed = parseId(id, "post ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();

	// Verify post exists by checking if any thread has posts
	// The mock repo delete will handle non-existent gracefully
	try {
		await repos.posts.delete(parsed.value);
	} catch {
		return errorResponse("Post not found", 404);
	}

	return NextResponse.json({ success: true });
}
