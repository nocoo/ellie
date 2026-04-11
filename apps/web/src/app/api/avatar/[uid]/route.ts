// Avatar proxy — hides CDN URL and handles fallback server-side
// GET /api/avatar/:uid?v=timestamp (for cache busting after upload)
// Note: ?size= is deprecated and ignored — always serves big avatar

import { FALLBACK_URL, computeAvatarCdnPath, getCacheControl } from "@/lib/avatar-proxy";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ uid: string }> },
): Promise<NextResponse> {
	const { uid: uidParam } = await params;
	const uid = Number.parseInt(uidParam, 10);

	if (Number.isNaN(uid) || uid <= 0) {
		return NextResponse.redirect(FALLBACK_URL);
	}

	// Check for cache-bust parameter
	const hasVersionParam = request.nextUrl.searchParams.has("v");

	const avatarUrl = computeAvatarCdnPath(uid);

	try {
		const response = await fetch(avatarUrl, {
			headers: {
				"User-Agent": "Ellie/1.0",
			},
		});

		if (!response.ok) {
			// Avatar not found, fetch and return fallback
			const fallbackResponse = await fetch(FALLBACK_URL);
			const fallbackData = await fallbackResponse.arrayBuffer();
			return new NextResponse(fallbackData, {
				status: 200,
				headers: {
					"Content-Type": "image/gif",
					"Cache-Control": getCacheControl(hasVersionParam, true),
				},
			});
		}

		const imageData = await response.arrayBuffer();
		const contentType = response.headers.get("Content-Type") || "image/jpeg";

		return new NextResponse(imageData, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Cache-Control": getCacheControl(hasVersionParam, false),
			},
		});
	} catch {
		// Network error, return fallback
		try {
			const fallbackResponse = await fetch(FALLBACK_URL);
			const fallbackData = await fallbackResponse.arrayBuffer();
			return new NextResponse(fallbackData, {
				status: 200,
				headers: {
					"Content-Type": "image/gif",
					"Cache-Control": getCacheControl(hasVersionParam, true),
				},
			});
		} catch {
			return new NextResponse("Avatar unavailable", { status: 503 });
		}
	}
}
