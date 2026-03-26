// api/admin/users/route.ts — Admin user management endpoints
// Ref: 04b §API 路由边界 — /api/admin/users (role ∈ {1,2})

import type { UserListParams } from "@/data/repositories/types";
import { errorResponse, getMockUserRole, getRepos, isAdminRole, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/users — List users (admin view with all fields)
 */
export async function GET(request: Request) {
	const role = getMockUserRole(request);
	if (role === null || !isAdminRole(role)) {
		return errorResponse("Forbidden: admin role required", 403);
	}

	const url = new URL(request.url);
	const repos = getRepos();

	const params: UserListParams = {
		search: url.searchParams.get("search") || undefined,
		role: url.searchParams.get("role")
			? (Number(url.searchParams.get("role")) as UserListParams["role"])
			: undefined,
		status: url.searchParams.get("status")
			? (Number(url.searchParams.get("status")) as UserListParams["status"])
			: undefined,
		sort: (url.searchParams.get("sort") as UserListParams["sort"]) || undefined,
		cursor: url.searchParams.get("cursor") || undefined,
		limit: Number(url.searchParams.get("limit")) || undefined,
	};

	const result = await repos.users.list(params);
	return NextResponse.json({ data: result });
}

/**
 * POST /api/admin/users — Perform admin action on a user
 *
 * Body: { action, userId, value }
 * Actions: "ban", "unban", "setRole"
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

	const { action, userId } = body as { action?: string; userId?: number };
	if (!action || !userId) {
		return errorResponse("Missing required fields: action, userId", 400);
	}

	const parsed = parseId(String(userId), "user ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const user = await repos.users.getById(parsed.value);
	if (!user) {
		return errorResponse("User not found", 404);
	}

	switch (action) {
		case "ban":
			await repos.users.setStatus(parsed.value, -1);
			break;
		case "unban":
			await repos.users.setStatus(parsed.value, 0);
			break;
		case "setRole": {
			const newRole = body.role as number;
			if (newRole === undefined) {
				return errorResponse("Missing role for setRole action", 400);
			}
			await repos.users.setRole(parsed.value, newRole);
			break;
		}
		default:
			return errorResponse(`Unknown action: ${action}`, 400);
	}

	return NextResponse.json({ success: true });
}
