// Avatar proxy — hides CDN URL and handles fallback server-side
// GET /api/avatar/:uid?v=timestamp (for cache busting after upload)
// Note: ?size= is deprecated and ignored — always serves big avatar

import { type NextRequest, NextResponse } from "next/server";

const CDN_BASE = "https://t.no.mt/avatar";
const FALLBACK_URL = "https://t.no.mt/static/image/common/tavatar.gif";

function computeAvatarPath(uid: number): string {
	const padded = uid.toString().padStart(9, "0");
	const dir1 = padded.slice(0, 3);
	const dir2 = padded.slice(3, 5);
	const dir3 = padded.slice(5, 7);
	const file = padded.slice(7, 9);
	// Always fetch big avatar — size parameter is deprecated
	return `${CDN_BASE}/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}

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

	const avatarUrl = computeAvatarPath(uid);

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
					"Cache-Control": "public, max-age=86400", // Cache fallback for 1 day
				},
			});
		}

		const imageData = await response.arrayBuffer();
		const contentType = response.headers.get("Content-Type") || "image/jpeg";

		// Use shorter cache when version param is present (fresh upload)
		// Browser will re-request without ?v= on next page load
		const cacheControl = hasVersionParam
			? "public, max-age=0, must-revalidate" // Force revalidation for fresh uploads
			: "public, max-age=604800"; // Cache avatars for 7 days

		return new NextResponse(imageData, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Cache-Control": cacheControl,
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
					"Cache-Control": "public, max-age=86400",
				},
			});
		} catch {
			return new NextResponse("Avatar unavailable", { status: 503 });
		}
	}
}
