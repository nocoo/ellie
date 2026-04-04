// Proxy route: GET /api/v1/users/search (no JWT required)
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const result = await forumApi.get<unknown>(
			"/api/v1/users/search",
			Object.fromEntries(url.searchParams),
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
