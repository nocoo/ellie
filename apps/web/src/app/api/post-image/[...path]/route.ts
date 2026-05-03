// Proxy route: GET /api/post-image/{uuid}.{ext}
//
// Public same-origin proxy that forwards browser requests to the Worker
// `/api/v1/post-images/{path}` endpoint with the server-only Key A. The
// browser never sees the Worker URL or the API key.
//
// The Worker side (apps/worker/src/lib/postImage.ts) already enforces
// strict path validation (only `post-images/{uuid}.{whitelisted-ext}`)
// and emits the safe Content-Type / nosniff / immutable cache headers.
// This route's job is simply to:
//   - reject anything that doesn't look like the canonical key shape so
//     we never even hit the Worker for traversal/garbage paths
//   - construct the Worker URL by joining encoded segments — never
//     accept an external URL or query string injection
//   - stream the body back with the Worker's status + the security &
//     cache headers preserved
import "server-only";

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
 * Same shape the Worker enforces: lowercase RFC 4122 UUID + whitelisted
 * image extension, single segment, no traversal.
 *
 * We re-validate here (instead of just trusting the Worker to 404) so:
 *   - we never spend a Worker round-trip on an obviously bad path
 *   - we cannot accidentally smuggle ".." or extra slashes through
 *     `decodeURIComponent` into the upstream URL
 */
const POST_IMAGE_PATH_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|gif)$/i;

function notFound(): NextResponse {
	return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
}

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse | Response> {
	const { path: segments } = await params;

	// Catch-all gives us a string[]; we only accept a single segment so
	// that nothing here can be tricked into hitting a different upstream
	// path. `[...path]` rejects an empty match at the routing layer, but
	// be defensive anyway.
	if (!Array.isArray(segments) || segments.length !== 1) {
		return notFound();
	}

	const segment = segments[0];
	if (!segment || !POST_IMAGE_PATH_RE.test(segment)) {
		return notFound();
	}

	// `encodeURIComponent` so even if the regex ever loosens we cannot
	// inject `?`/`#`/`/` into the upstream URL.
	const upstream = `${getWorkerUrl()}/api/v1/post-images/${encodeURIComponent(segment)}`;

	let res: Response;
	try {
		res = await fetch(upstream, {
			method: "GET",
			headers: {
				"X-API-Key": getApiKey(),
				"User-Agent": "Ellie/1.0",
			},
			// Public asset — Next can cache the route output, but we don't
			// want the per-request fetch to be cached at the fetch layer in
			// dev/preview either way.
			cache: "no-store",
		});
	} catch (err) {
		console.error("[post-image/route] fetch error:", err);
		return NextResponse.json(
			{ error: { code: "UPSTREAM_UNAVAILABLE", message: "Upstream unavailable" } },
			{ status: 502 },
		);
	}

	if (res.status === 404) {
		return notFound();
	}

	if (!res.ok) {
		// Don't pass through the upstream body verbatim — it might be a
		// JSON error envelope or something else; force a clean error
		// shape so this route always returns either an image or a small
		// JSON error.
		return NextResponse.json(
			{
				error: {
					code: "UPSTREAM_ERROR",
					message: `Upstream returned ${res.status}`,
				},
			},
			{ status: res.status },
		);
	}

	// Preserve Worker's security + cache headers for the image response.
	// Worker is the source of truth for Content-Type (it derives from the
	// extension whitelist) and for `nosniff`/immutable cache.
	const headers = new Headers();
	const ct = res.headers.get("Content-Type");
	if (ct) headers.set("Content-Type", ct);
	const nosniff = res.headers.get("X-Content-Type-Options");
	if (nosniff) headers.set("X-Content-Type-Options", nosniff);
	const cache = res.headers.get("Cache-Control");
	if (cache) headers.set("Cache-Control", cache);

	return new Response(res.body, {
		status: 200,
		headers,
	});
}
