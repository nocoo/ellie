// api/v1/users/[id]/route.ts — User profile detail endpoint
// Ref: 04b §API 路由边界 — /api/v1/users/:id (public)

import { errorResponse, getRepos, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/users/:id — Get user profile by ID
 */
export async function GET(_request: Request, { params }: RouteParams) {
	const { id } = await params;
	const parsed = parseId(id, "user ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const user = await repos.users.getById(parsed.value);
	if (!user) {
		return errorResponse("User not found", 404);
	}

	return NextResponse.json({ data: user });
}
