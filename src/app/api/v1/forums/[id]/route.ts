// api/v1/forums/[id]/route.ts — Forum detail endpoint
// Ref: 04b §API 路由边界 — /api/v1/forums/:id (public)

import { createRepositories } from "@/data/index";
import { NextResponse } from "next/server";

/**
 * GET /api/v1/forums/:id — Get forum by ID
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const forumId = Number(id);
	if (Number.isNaN(forumId)) {
		return NextResponse.json({ error: "Invalid forum ID" }, { status: 400 });
	}

	const repos = createRepositories();
	const forum = await repos.forums.getById(forumId);
	if (!forum) {
		return NextResponse.json({ error: "Forum not found" }, { status: 404 });
	}

	return NextResponse.json({ data: forum });
}
