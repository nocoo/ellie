// api/admin/forums/route.ts — Admin forum management endpoints
// Ref: 04b §API 路由边界 — /api/admin/forums (role ∈ {1,2})

import { errorResponse, getMockUserRole, getRepos, isAdminRole, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/forums — List all forums (admin view)
 */
export async function GET(request: Request) {
	const role = getMockUserRole(request);
	if (role === null || !isAdminRole(role)) {
		return errorResponse("Forbidden: admin role required", 403);
	}

	const repos = getRepos();
	const forums = await repos.forums.listAll();
	return NextResponse.json({ data: forums });
}

/**
 * POST /api/admin/forums — Update forum settings
 *
 * Body: { forumId, name?, description?, icon?, status?, displayOrder? }
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

	const { forumId, ...updates } = body as {
		forumId?: number;
		name?: string;
		description?: string;
		icon?: string;
		status?: number;
		displayOrder?: number;
	};

	if (!forumId) {
		return errorResponse("Missing required field: forumId", 400);
	}

	const parsed = parseId(String(forumId), "forum ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const forum = await repos.forums.getById(parsed.value);
	if (!forum) {
		return errorResponse("Forum not found", 404);
	}

	await repos.forums.update(parsed.value, updates);
	return NextResponse.json({ success: true });
}
