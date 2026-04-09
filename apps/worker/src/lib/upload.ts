// Upload handler — handles file uploads (avatar, future: attachments)
// Currently supports avatar uploads with validation and R2 storage

import { errorResponse } from "../middleware/error";
import { computeAvatarPath } from "./avatar-path";
import type { Env } from "./env";
import { jsonResponse } from "./response";
import { UPLOAD_CONFIGS } from "./upload-config";
import { invalidateUserCache } from "./user-cache";

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
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid multipart form data" }, origin);
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

	// Validate MIME type
	if (!config.allowedMimeTypes.includes(file.type)) {
		return errorResponse(
			"INVALID_FORMAT",
			415,
			{
				message: "Only JPG and PNG formats are allowed",
				allowedTypes: config.allowedMimeTypes,
				actualType: file.type,
			},
			origin,
		);
	}

	// Read file content
	const arrayBuffer = await file.arrayBuffer();

	// Handle avatar upload
	if (purpose === "avatar") {
		return handleAvatarUpload(env, ctx, userId, arrayBuffer, file.type, origin);
	}

	// Future: handle other purposes
	return errorResponse("INVALID_PURPOSE", 400, undefined, origin);
}

/**
 * Handle avatar-specific upload logic.
 */
async function handleAvatarUpload(
	env: Env,
	ctx: ExecutionContext,
	userId: number,
	imageData: ArrayBuffer,
	mimeType: string,
	origin?: string,
): Promise<Response> {
	// Generate R2 key path
	const key = computeAvatarPath(userId);

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

	// Update user record — set has_avatar = 1
	await env.DB.prepare("UPDATE users SET has_avatar = 1 WHERE id = ?").bind(userId).run();

	// Invalidate user cache (non-blocking)
	ctx.waitUntil(invalidateUserCache(env, userId));

	return jsonResponse(
		{
			url: `/api/avatar/${userId}`,
			size: imageData.byteLength,
		},
		origin,
	);
}
