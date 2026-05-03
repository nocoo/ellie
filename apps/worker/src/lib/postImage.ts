// Post-image storage and retrieval helpers.
// Owns the R2 key shape (`post-images/{uuid}.{ext}`) and the strict
// path validation used by the public GET endpoint. See B1 of the
// new-thread/reply UX batch.

import { errorResponse } from "../middleware/error";
import type { Env } from "./env";
import { jsonResponse } from "./response";

/** Canonical MIME → file extension for post-image uploads. */
const MIME_TO_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

/** Canonical extension → MIME for post-image GET responses. */
const EXT_TO_MIME: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
};

/** R2 key prefix for post images. */
export const POST_IMAGE_PREFIX = "post-images/";

/** RFC 4122 lowercase UUID, e.g. `550e8400-e29b-41d4-a716-446655440000`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Build a post-image R2 key for a freshly uploaded file.
 *
 * The path uses a freshly generated UUID so that callers can never collide
 * on filename and so the public URL doesn't leak user IDs.
 */
export function generatePostImagePath(mimeType: string): string {
	const ext = MIME_TO_EXT[mimeType] ?? "jpg";
	return `${POST_IMAGE_PREFIX}${crypto.randomUUID()}.${ext}`;
}

/**
 * Validate a path-suffix as a legitimate post-image R2 key.
 *
 * Accepts only `{uuid}.{whitelisted-ext}` (no leading prefix). Returns the
 * full R2 key (`post-images/{uuid}.{ext}`) and the canonical MIME on
 * success, `null` on any deviation. Rejects:
 *   - traversal segments (`.`, `..`)
 *   - empty segments / multiple slashes
 *   - any extension outside the whitelist
 *   - non-UUID basenames
 */
export function validatePostImageKey(pathSuffix: string): { key: string; mime: string } | null {
	// No traversal, no extra slashes, no empty pieces
	if (
		pathSuffix.length === 0 ||
		pathSuffix.includes("..") ||
		pathSuffix.includes("//") ||
		pathSuffix.includes("\\") ||
		pathSuffix.startsWith("/") ||
		pathSuffix.endsWith("/")
	) {
		return null;
	}

	// Must look exactly like `{uuid}.{ext}` — single segment
	if (pathSuffix.includes("/")) return null;

	const dot = pathSuffix.lastIndexOf(".");
	if (dot <= 0 || dot === pathSuffix.length - 1) return null;

	const basename = pathSuffix.slice(0, dot);
	const ext = pathSuffix.slice(dot + 1).toLowerCase();

	if (!UUID_RE.test(basename)) return null;
	const mime = EXT_TO_MIME[ext];
	if (!mime) return null;

	return { key: `${POST_IMAGE_PREFIX}${basename}.${ext}`, mime };
}

/**
 * Handle a successful post-image upload: store in R2 and return the
 * canonical public URL the editor should embed. Does NOT touch the user
 * record (unlike avatar upload — post images are not per-user state).
 */
export async function handlePostImageUpload(
	env: Env,
	imageData: ArrayBuffer,
	mimeType: string,
	origin?: string,
): Promise<Response> {
	const key = generatePostImagePath(mimeType);

	try {
		await env.R2.put(key, imageData, {
			httpMetadata: { contentType: mimeType },
		});
	} catch (err) {
		return errorResponse(
			"UPLOAD_FAILED",
			500,
			{ message: err instanceof Error ? err.message : "R2 upload failed" },
			origin,
		);
	}

	// `path` matches the suffix the GET route validates and reads from R2,
	// so the editor can call `/api/v1/post-images/{path}` (via the Next
	// proxy added in B2).
	const path = key.slice(POST_IMAGE_PREFIX.length);
	return jsonResponse(
		{
			url: `/api/post-image/${path}`,
			path: key,
			size: imageData.byteLength,
			contentType: mimeType,
		},
		origin,
	);
}

/**
 * Public-asset GET for post images. Streams the R2 object back with
 * immutable cache headers and `nosniff` so a malicious upload cannot be
 * reinterpreted as HTML/JS by the browser. Path validation is done by
 * `validatePostImageKey` so traversal/wrong prefix/wrong ext are 404'd
 * before we ever touch R2.
 */
export async function handleGetPostImage(
	pathSuffix: string,
	env: Env,
	origin?: string,
): Promise<Response> {
	const validated = validatePostImageKey(pathSuffix);
	if (!validated) {
		return errorResponse("NOT_FOUND", 404, undefined, origin);
	}

	const obj = await env.R2.get(validated.key);
	if (!obj) {
		return errorResponse("NOT_FOUND", 404, undefined, origin);
	}

	// Always derive Content-Type from the validated extension whitelist —
	// never trust R2-stored metadata. If something else (a misconfigured
	// admin write, a future bug) ever puts an object at this key shape
	// with `text/html` metadata, `nosniff` cannot rescue an explicit HTML
	// content-type. The extension is already constrained to a tiny
	// image-only whitelist by `validatePostImageKey`, so this is the only
	// safe source of truth here.
	const contentType = validated.mime;

	return new Response(obj.body, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
