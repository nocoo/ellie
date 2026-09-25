// Proxy GET /api/v1/settings to Worker API
// Used by useFeatureFlags hook to fetch feature flags

import { NextResponse } from "next/server";
import { getPublicSettings } from "@/lib/public-settings";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix") || undefined;

	try {
		const settings = await getPublicSettings();
		return NextResponse.json(
			prefix
				? Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith(prefix)))
				: settings,
		);
	} catch (error) {
		console.error("Failed to fetch settings:", error);
		// Return empty object on error to avoid breaking the UI
		return NextResponse.json({});
	}
}
