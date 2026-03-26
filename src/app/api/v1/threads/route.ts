// api/v1/threads/route.ts — Thread list + create endpoints
// Ref: 04b §API 路由边界 — /api/v1/threads (read: public, write: auth)

import type { ThreadListParams, ThreadSearchParams } from "@/data/repositories/types";
import { getAuthUserId } from "@/lib/api-auth";
import { errorResponse, getRepos } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/threads — List threads with optional filters
 *
 * Query params:
 * - forumId: filter by forum
 * - sort: "latest" | "newest" | "hot"
 * - digest: "true" to filter digest-only
 * - cursor / limit: pagination
 * - search: title prefix search
 * - author: author name search
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const repos = getRepos();

	// Check if this is a search request
	const search = url.searchParams.get("search");
	const author = url.searchParams.get("author");

	if (search || author) {
		const searchParams: ThreadSearchParams = {
			titlePrefix: search || undefined,
			authorName: author || undefined,
			cursor: url.searchParams.get("cursor") || undefined,
			limit: Number(url.searchParams.get("limit")) || undefined,
		};
		const result = await repos.threads.search(searchParams);
		return NextResponse.json({ data: result });
	}

	// Normal list
	const params: ThreadListParams = {
		forumId: url.searchParams.get("forumId") ? Number(url.searchParams.get("forumId")) : undefined,
		sort: (url.searchParams.get("sort") as ThreadListParams["sort"]) || undefined,
		digest: url.searchParams.get("digest") === "true" || undefined,
		cursor: url.searchParams.get("cursor") || undefined,
		limit: Number(url.searchParams.get("limit")) || undefined,
	};
	const result = await repos.threads.list(params);
	return NextResponse.json({ data: result });
}

/**
 * POST /api/v1/threads — Create a new thread
 *
 * Body: { forumId, subject, content }
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

	const { forumId, subject, content } = body as {
		forumId?: number;
		subject?: string;
		content?: string;
	};

	if (!forumId || !subject || !content) {
		return errorResponse("Missing required fields: forumId, subject, content", 400);
	}

	// Resolve author from authenticated user
	const user = await repos.users.getById(authorId);
	const authorName = user?.username ?? "anonymous";

	const thread = await repos.threads.create({
		forumId,
		authorId,
		authorName,
		subject,
		content,
	});

	return NextResponse.json({ data: thread }, { status: 201 });
}
