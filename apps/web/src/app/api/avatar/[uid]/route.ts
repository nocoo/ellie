// Avatar proxy — hides CDN URL and handles fallback server-side
// GET /api/avatar/:uid?v=timestamp (for cache busting after upload)
// Note: ?size= is deprecated and ignored — always serves big avatar
//
// Avatar resolution:
// 1. If user has avatar_path set (GUID-based), use CDN_BASE/{avatar_path}
// 2. Otherwise fallback to legacy UID-based path: CDN_BASE/avatar/{dir structure}

import { type NextRequest, NextResponse } from "next/server";
import { computeAvatarCdnPath, FALLBACK_URL, getCacheControl } from "@/lib/avatar-proxy";

function getWorkerUrl(): string {
	const url = process.env.WORKER_API_URL;
	if (!url) throw new Error("WORKER_API_URL environment variable is not set");
	return url.replace(/\/+$/, "");
}

function getApiKey(): string {
	const key = process.env.FORUM_API_KEY;
	if (!key) throw new Error("FORUM_API_KEY environment variable is not set");
	return key;
}

/** Result of fetching avatar path from Worker */
type AvatarPathResult =
	| { status: "found"; avatarPath: string } // User exists, avatarPath may be empty (use legacy)
	| { status: "not_found" } // User doesn't exist
	| { status: "error" }; // Network/API error — should not cache

/**
 * Fetch user's avatar_path from Worker API.
 * Uses internal endpoint that doesn't check user status.
 */
async function getUserAvatarPath(uid: number): Promise<AvatarPathResult> {
	try {
		const res = await fetch(`${getWorkerUrl()}/api/v1/users/${uid}/avatar-path`, {
			headers: {
				"X-API-Key": getApiKey(),
				"User-Agent": "Ellie/1.0",
			},
			cache: "no-store",
		});

		if (res.status === 404) {
			return { status: "not_found" };
		}

		if (!res.ok) {
			return { status: "error" };
		}

		const json = (await res.json()) as { data?: { avatarPath?: string } };
		return { status: "found", avatarPath: json.data?.avatarPath ?? "" };
	} catch {
		return { status: "error" };
	}
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

	// Get user's avatar_path from Worker API
	const result = await getUserAvatarPath(uid);

	// If API error, return fallback with short cache (5 min) to avoid caching errors for a day
	if (result.status === "error") {
		try {
			const fallbackResponse = await fetch(FALLBACK_URL);
			const fallbackData = await fallbackResponse.arrayBuffer();
			return new NextResponse(fallbackData, {
				status: 200,
				headers: {
					"Content-Type": "image/gif",
					// Short cache for errors — retry in 5 minutes
					"Cache-Control": "public, max-age=300",
				},
			});
		} catch {
			return new NextResponse("Avatar unavailable", { status: 503 });
		}
	}

	// If user not found, return fallback with normal cache
	if (result.status === "not_found") {
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

	// Compute CDN URL based on avatar_path or fallback to legacy UID-based path
	const avatarUrl = computeAvatarCdnPath(uid, result.avatarPath);

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
		// Network error, return fallback with short cache
		try {
			const fallbackResponse = await fetch(FALLBACK_URL);
			const fallbackData = await fallbackResponse.arrayBuffer();
			return new NextResponse(fallbackData, {
				status: 200,
				headers: {
					"Content-Type": "image/gif",
					// Short cache for network errors
					"Cache-Control": "public, max-age=300",
				},
			});
		} catch {
			return new NextResponse("Avatar unavailable", { status: 503 });
		}
	}
}
