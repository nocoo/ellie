// Proxy GET /api/v1/settings to Worker API
// Used by useFeatureFlags hook to fetch feature flags

import { NextResponse } from "next/server";
import { forumApi } from "@/lib/forum-api";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix") || undefined;

	try {
		const result = await forumApi.get<Record<string, string | number | boolean>>(
			"/api/v1/settings",
			{ prefix },
		);
		return NextResponse.json(result.data);
	} catch (error) {
		console.error("Failed to fetch settings:", error);
		// Return empty object on error to avoid breaking the UI
		return NextResponse.json({});
	}
}
