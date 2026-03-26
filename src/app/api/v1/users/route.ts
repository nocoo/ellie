// api/v1/users/route.ts — User list endpoint
// Ref: 04b §API 路由边界 — /api/v1/users (public)

import type { UserListParams } from "@/data/repositories/types";
import { getRepos } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/users — List users with optional filters
 *
 * Query params:
 * - search: search by username
 * - role: filter by role
 * - status: filter by status
 * - sort: "newest" | "lastLogin"
 * - cursor / limit: pagination
 */
export async function GET(request: Request) {
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
