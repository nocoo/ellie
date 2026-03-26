// api/v1/forums/route.ts — Forum list endpoint
// Ref: 04b §API 路由边界 — /api/v1/forums (public)

import { createRepositories } from "@/data/index";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/forums — List all forums
 */
export async function GET() {
	const repos = createRepositories();
	const forums = await repos.forums.listAll();
	return NextResponse.json({ data: forums });
}
