// api/v1/threads/[id]/route.ts — Thread detail + delete endpoints
// Ref: 04b §API 路由边界 — /api/v1/threads/:id (read: public, delete: auth)

import { errorResponse, getRepos, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/threads/:id — Get thread by ID
 */
export async function GET(_request: Request, { params }: RouteParams) {
	const { id } = await params;
	const parsed = parseId(id, "thread ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const thread = await repos.threads.getById(parsed.value);
	if (!thread) {
		return errorResponse("Thread not found", 404);
	}

	return NextResponse.json({ data: thread });
}

/**
 * DELETE /api/v1/threads/:id — Delete a thread
 *
 * Requires auth (Phase 2: checked via session + ownership/mod role).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
	const { id } = await params;
	const parsed = parseId(id, "thread ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const thread = await repos.threads.getById(parsed.value);
	if (!thread) {
		return errorResponse("Thread not found", 404);
	}

	await repos.threads.delete(parsed.value);
	return NextResponse.json({ success: true });
}
