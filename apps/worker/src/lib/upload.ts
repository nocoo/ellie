// Upload handler — handles file uploads (avatar, post-image, future: attachments)
// All upload purposes share size/MIME validation, magic-byte sniffing, and the
// same authenticated multipart request shape; per-purpose handlers diverge on
// where the bytes are stored and what response shape the client gets.

import { errorResponse } from "../middleware/error";
import type { Env } from "./env";
import { sniffImageType } from "./imageMagicBytes";
import { handlePostImageUpload } from "./postImage";
import { jsonResponse } from "./response";
import { UPLOAD_CONFIGS } from "./upload-config";
import { invalidateUserCache } from "./user-cache";

/**
 * Generate a GUID-based avatar path.
 * Uses crypto.randomUUID() for unique filenames that bypass cache issues.
 *
 * @param mimeType - File MIME type to determine extension
 * @returns R2 key path like "avatars/550e8400-e29b-41d4-a716-446655440000.jpg"
 */
export function generateAvatarPath(mimeType: string): string {
	const uuid = crypto.randomUUID();
	const ext = mimeType === "image/png" ? "png" : "jpg";
	return `avatars/${uuid}.${ext}`;
}

/**
 * Handle file upload requests.
 *
 * @param request - Incoming request with multipart/form-data body
 * @param env - Worker environment
 * @param ctx - Execution context for waitUntil
 * @param userId - Authenticated user ID
 * @param origin - Request origin for CORS headers
 */
export async function handleUpload(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	userId: number,
	origin?: string,
): Promise<Response> {
	// Parse multipart form data
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Invalid multipart form data" },
			origin,
		);
	}

	const file = formData.get("file") as File | null;
	const purpose = formData.get("purpose") as string | null;

	// Validate purpose — use Object.hasOwn to avoid prototype pollution
	if (!purpose || !Object.hasOwn(UPLOAD_CONFIGS, purpose)) {
		return errorResponse("INVALID_PURPOSE", 400, undefined, origin);
	}

	const config = UPLOAD_CONFIGS[purpose];

	// Validate file exists
	if (!file) {
		return errorResponse("NO_FILE", 400, undefined, origin);
	}

	// Validate size
	if (file.size > config.maxSize) {
		return errorResponse(
			"FILE_TOO_LARGE",
			413,
			{
				message: `File size exceeds ${config.maxSize / 1024} KB limit`,
				maxSize: config.maxSize,
				actualSize: file.size,
			},
			origin,
		);
	}

	// Validate the client-claimed MIME type (cheap reject before reading body)
	if (!config.allowedMimeTypes.includes(file.type)) {
		return errorResponse(
			"INVALID_FORMAT",
			415,
			{
				message: `Only ${config.formatsLabel} formats are allowed`,
				allowedTypes: config.allowedMimeTypes,
				actualType: file.type,
			},
			origin,
		);
	}

	// Read file content
	const arrayBuffer = await file.arrayBuffer();

	// Magic-byte sniff — never trust the client-supplied Content-Type alone.
	// Reject if the bytes don't match any whitelisted image format, or if the
	// sniffed format isn't allowed by the per-purpose config.
	const sniffed = sniffImageType(arrayBuffer);
	if (!sniffed || !config.allowedMimeTypes.includes(sniffed)) {
		return errorResponse(
			"INVALID_FORMAT",
			415,
			{
				message: `File contents do not match an accepted image format (${config.formatsLabel})`,
				allowedTypes: config.allowedMimeTypes,
				actualType: file.type,
				sniffedType: sniffed,
			},
			origin,
		);
	}

	// Handle avatar upload — use the sniffed MIME so a mislabeled JPEG can't
	// land in R2 with the wrong Content-Type.
	if (purpose === "avatar") {
		return handleAvatarUpload(env, ctx, userId, arrayBuffer, sniffed, origin);
	}

	if (purpose === "post-image") {
		return handlePostImageUpload(env, arrayBuffer, sniffed, origin);
	}

	// Unknown purpose that nonetheless passed the Object.hasOwn check —
	// indicates a config entry without a handler. Fail closed.
	return errorResponse("INVALID_PURPOSE", 400, undefined, origin);
}

/**
 * Handle avatar-specific upload logic.
 * Generates a new GUID-based path for each upload to avoid cache issues.
 */
async function handleAvatarUpload(
	env: Env,
	ctx: ExecutionContext,
	userId: number,
	imageData: ArrayBuffer,
	mimeType: string,
	origin?: string,
): Promise<Response> {
	// Generate unique GUID-based path
	const key = generateAvatarPath(mimeType);

	try {
		// Upload to R2 with original MIME type
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

	// Update user record — set avatar_path and has_avatar = 1
	await env.DB.prepare("UPDATE users SET avatar_path = ?, has_avatar = 1 WHERE id = ?")
		.bind(key, userId)
		.run();

	// Invalidate user cache (non-blocking)
	ctx.waitUntil(invalidateUserCache(env, userId));

	return jsonResponse(
		{
			url: `/api/avatar/${userId}`,
			path: key,
			size: imageData.byteLength,
		},
		origin,
	);
}
