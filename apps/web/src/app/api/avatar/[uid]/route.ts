// Avatar proxy — hides CDN URL and handles fallback server-side
// GET /api/avatar/:uid?v=timestamp (for cache busting after upload)
// Note: ?size= is deprecated and ignored — always serves big avatar
//
// Avatar resolution:
// 1. If user has avatar_path set (GUID-based), use CDN_BASE/{avatar_path}
// 2. Otherwise fallback to legacy UID-based path: CDN_BASE/avatar/{dir structure}

import {
	FALLBACK_URL,
	computeAvatarCdnPath,
	getCacheControl,
} from "@/lib/avatar-proxy";
import { type NextRequest, NextResponse } from "next/server";

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

/**
 * Fetch user's avatar_path from Worker API.
 * Returns empty string if user not found or avatar_path not set.
 */
async function getUserAvatarPath(uid: number): Promise<string> {
	try {
		const res = await fetch(`${getWorkerUrl()}/api/v1/users/${uid}`, {
			headers: {
				"X-API-Key": getApiKey(),
				"User-Agent": "Ellie/1.0",
			},
			cache: "no-store",
		});

		if (!res.ok) {
			return "";
		}

		const json = (await res.json()) as { data?: { avatarPath?: string } };
		return json.data?.avatarPath ?? "";
	} catch {
		return "";
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
	const avatarPath = await getUserAvatarPath(uid);

	// Compute CDN URL based on avatar_path or fallback to legacy UID-based path
	const avatarUrl = computeAvatarCdnPath(uid, avatarPath);

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
