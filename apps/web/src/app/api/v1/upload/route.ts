// Proxy route: POST /api/v1/upload (multipart/form-data)
// Compresses avatars before forwarding uploads to Worker with JWT authentication
import "server-only";

import { NextResponse } from "next/server";
import sharp from "sharp";
import { AVATAR_ALLOWED_TYPES, AVATAR_MAX_UPLOAD_MB } from "@/lib/avatar";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { ForumApiError } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse, isEmailNotVerifiedPayload } from "@/lib/proxy-error";

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

async function compressAvatar(formData: FormData): Promise<Response | null> {
	const file = formData.get("file");
	if (!file || typeof file === "string") {
		return NextResponse.json(
			{ error: { code: "NO_FILE", message: "请选择头像图片" } },
			{ status: 400 },
		);
	}
	if (file.size > AVATAR_MAX_UPLOAD_MB * 1024 * 1024) {
		return NextResponse.json(
			{ error: { code: "FILE_TOO_LARGE", message: `文件大小不能超过 ${AVATAR_MAX_UPLOAD_MB} MB` } },
			{ status: 413 },
		);
	}
	if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
		return NextResponse.json(
			{ error: { code: "INVALID_FORMAT", message: "仅支持 JPG 和 PNG 格式" } },
			{ status: 415 },
		);
	}

	try {
		const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 });
		const { format } = await image.metadata();
		if (format !== "jpeg" && format !== "png") throw new Error("Unsupported avatar format");

		// Largest forum avatar is 80 CSS px; 360 px leaves room for high-DPI displays.
		const jpeg = await image
			.rotate()
			.resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
			.flatten({ background: "#ffffff" })
			.jpeg({ quality: 80 })
			.toBuffer();
		formData.set("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "avatar.jpg");
		return null;
	} catch {
		return NextResponse.json(
			{ error: { code: "INVALID_FORMAT", message: "请上传有效的 JPG 或 PNG 图片" } },
			{ status: 415 },
		);
	}
}

export async function POST(request: Request) {
	// CSRF protection
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[upload/route] getWorkerJwt error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Failed to get session" } },
			{ status: 500 },
		);
	}

	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const contentType = request.headers.get("Content-Type");

		if (!contentType?.includes("multipart/form-data")) {
			return NextResponse.json(
				{ error: { code: "INVALID_REQUEST", message: "Content-Type must be multipart/form-data" } },
				{ status: 400 },
			);
		}

		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return NextResponse.json(
				{ error: { code: "INVALID_REQUEST", message: "Invalid multipart form data" } },
				{ status: 400 },
			);
		}
		if (formData.get("purpose") === "avatar") {
			const error = await compressAvatar(formData);
			if (error) return error;
		}

		// Forward to Worker with correct headers
		const workerUrl = `${getWorkerUrl()}/api/v1/upload`;
		const res = await fetch(workerUrl, {
			method: "POST",
			headers: {
				"X-API-Key": getApiKey(),
				Authorization: `Bearer ${jwt}`,
			},
			// fetch generates the Content-Type boundary for the updated FormData.
			body: formData,
		});

		// Parse Worker response
		const text = await res.text();
		let json: Record<string, unknown>;
		try {
			json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
		} catch {
			console.error("[upload/route] Failed to parse Worker response:", text.slice(0, 200));
			return NextResponse.json(
				{ error: { code: "INTERNAL_ERROR", message: "Failed to parse Worker response" } },
				{ status: 500 },
			);
		}

		if (!res.ok) {
			// docs/17 §5.4 EmailNotVerifiedPayload uses a flat shape
			// (`{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }`).
			// Forward verbatim so the browser's email-verification dialog
			// trigger (api-client → dispatchEmailNotVerified) still fires.
			if (isEmailNotVerifiedPayload(json)) {
				return NextResponse.json(json, { status: res.status });
			}
			const errorData = json.error as { code: string; message: string } | undefined;
			return NextResponse.json(
				{ error: errorData ?? { code: "UNKNOWN", message: `Worker returned ${res.status}` } },
				{ status: res.status },
			);
		}

		return NextResponse.json(json, { status: res.status });
	} catch (err) {
		if (err instanceof ForumApiError) {
			return forumApiErrorToProxyResponse(err);
		}
		console.error("[upload/route] fetch error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
