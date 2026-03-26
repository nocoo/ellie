// api/v1/posts/route.ts — Post list + create endpoints
// Ref: 04b §API 路由边界 — /api/v1/posts (read: public, write: auth)

import type { PostListParams } from "@/data/repositories/types";
import { getAuthUserId } from "@/lib/api-auth";
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
 * Requires auth: session cookie (browser) or X-Mock-Uid header (API testing).
 */
export async function POST(request: Request) {
	const authorId = await getAuthUserId(request);
	if (!authorId) {
		return errorResponse("Authentication required", 401);
	}

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

	// Resolve author from authenticated user
	const user = await repos.users.getById(authorId);
	const authorName = user?.username ?? "anonymous";

	const post = await repos.posts.create({
		threadId,
		authorId,
		authorName,
		content,
	});

	return NextResponse.json({ data: post }, { status: 201 });
}
