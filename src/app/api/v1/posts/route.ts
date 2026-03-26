// api/v1/posts/route.ts — Post list + create endpoints
// Ref: 04b §API 路由边界 — /api/v1/posts (read: public, write: auth)

import type { PostListParams } from "@/data/repositories/types";
import { errorResponse, getRepos } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/posts — List posts with optional filters
 *
 * Query params:
 * - threadId: filter by thread (required for meaningful results)
 * - authorId: filter by author
 * - cursor / limit: pagination
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const repos = getRepos();

	const params: PostListParams = {
		threadId: url.searchParams.get("threadId")
			? Number(url.searchParams.get("threadId"))
			: undefined,
		authorId: url.searchParams.get("authorId")
			? Number(url.searchParams.get("authorId"))
			: undefined,
		cursor: url.searchParams.get("cursor") || undefined,
		limit: Number(url.searchParams.get("limit")) || undefined,
	};

	const result = await repos.posts.list(params);
	return NextResponse.json({ data: result });
}

/**
 * POST /api/v1/posts — Create a new post (reply)
 *
 * Body: { threadId, content }
 * Requires auth (Phase 2: checked via session).
 * Mock phase: uses authorId=1, authorName="admin".
 */
export async function POST(request: Request) {
	const repos = getRepos();

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400);
	}

	const { threadId, content } = body as {
		threadId?: number;
		content?: string;
	};

	if (!threadId || !content) {
		return errorResponse("Missing required fields: threadId, content", 400);
	}

	// Phase 2: get authorId/authorName from session
	const post = await repos.posts.create({
		threadId,
		authorId: 1,
		authorName: "admin",
		content,
	});

	return NextResponse.json({ data: post }, { status: 201 });
}
