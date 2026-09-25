import { type NextRequest, NextResponse } from "next/server";
import {
	AVATAR_EDGE_CACHE_CONTROL,
	AVATAR_PROXY_CACHE_CONTROL,
	computeAvatarCdnPath,
	FALLBACK_URL,
} from "@/lib/avatar-proxy";

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
		return typeof json.data?.avatarPath === "string"
			? { status: "found", avatarPath: json.data.avatarPath }
			: { status: "error" };
	} catch {
		return { status: "error" };
	}
}

const UNCACHED_HEADERS = {
	"Cache-Control": "no-store",
	"Cloudflare-CDN-Cache-Control": "no-store",
};

async function fallbackAvatar(): Promise<NextResponse> {
	try {
		const response = await fetch(FALLBACK_URL);
		if (!response.ok) throw new Error("Fallback unavailable");
		return new NextResponse(await response.arrayBuffer(), {
			headers: { ...UNCACHED_HEADERS, "Content-Type": "image/gif" },
		});
	} catch {
		return new NextResponse("Avatar unavailable", { status: 503, headers: UNCACHED_HEADERS });
	}
}

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ uid: string }> },
): Promise<NextResponse> {
	const { uid: uidParam } = await params;
	const uid = Number(uidParam);
	if (!/^\d+$/.test(uidParam) || !Number.isSafeInteger(uid) || uid <= 0) {
		return NextResponse.redirect(FALLBACK_URL, { headers: UNCACHED_HEADERS });
	}

	const result = await getUserAvatarPath(uid);
	if (result.status !== "found") return fallbackAvatar();

	try {
		const response = await fetch(computeAvatarCdnPath(uid, result.avatarPath), {
			headers: { "User-Agent": "Ellie/1.0" },
		});
		if (!response.ok) return fallbackAvatar();
		return new NextResponse(await response.arrayBuffer(), {
			headers: {
				"Content-Type": response.headers.get("Content-Type") || "image/jpeg",
				"Cache-Control": AVATAR_PROXY_CACHE_CONTROL,
				"Cloudflare-CDN-Cache-Control": AVATAR_EDGE_CACHE_CONTROL,
			},
		});
	} catch {
		return fallbackAvatar();
	}
}
