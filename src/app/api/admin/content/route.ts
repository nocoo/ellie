// api/admin/content/route.ts — Admin content moderation endpoints
// Ref: 04b §API 路由边界 — /api/admin/content (role ∈ {1,2})

import { errorResponse, getMockUserRole, getRepos, isAdminRole, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/content — List threads/posts for content moderation
 */
export async function GET(request: Request) {
	const role = getMockUserRole(request);
	if (role === null || !isAdminRole(role)) {
		return errorResponse("Forbidden: admin role required", 403);
	}

	const url = new URL(request.url);
	const repos = getRepos();
	const type = url.searchParams.get("type") || "threads";

	if (type === "posts") {
		// Post list requires a threadId filter — admin can specify via query param
		const threadId = url.searchParams.get("threadId")
			? Number(url.searchParams.get("threadId"))
			: undefined;
		if (!threadId) {
			return errorResponse("threadId query param required for post listing", 400);
		}
		const result = await repos.posts.list({
			threadId,
			cursor: url.searchParams.get("cursor") || undefined,
			limit: Number(url.searchParams.get("limit")) || undefined,
		});
		return NextResponse.json({ data: result });
	}

	const result = await repos.threads.list({
		cursor: url.searchParams.get("cursor") || undefined,
		limit: Number(url.searchParams.get("limit")) || undefined,
	});
	return NextResponse.json({ data: result });
}

/**
 * POST /api/admin/content — Delete content
 *
 * Body: { type: "thread" | "post", id }
 */
export async function POST(request: Request) {
	const role = getMockUserRole(request);
	if (role === null || !isAdminRole(role)) {
		return errorResponse("Forbidden: admin role required", 403);
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400);
	}

	const { type, id } = body as { type?: string; id?: number };
	if (!type || !id) {
		return errorResponse("Missing required fields: type, id", 400);
	}

	const parsed = parseId(String(id), `${type} ID`);
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();

	switch (type) {
		case "thread":
			await repos.threads.delete(parsed.value);
			break;
		case "post":
			await repos.posts.delete(parsed.value);
			break;
		default:
			return errorResponse(`Unknown content type: ${type}`, 400);
	}

	return NextResponse.json({ success: true });
}
