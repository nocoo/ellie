import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/lib/env";
import { generateAvatarPath, handleUpload } from "../../../src/lib/upload";
import { createMockCtx, createMockDb, createMockKV, createMockR2 } from "../../helpers";

describe("generateAvatarPath", () => {
	it("should generate GUID-based path for JPEG", () => {
		const path = generateAvatarPath("image/jpeg");
		expect(path).toMatch(/^avatars\/[a-f0-9-]+\.jpg$/);
	});

	it("should generate GUID-based path for PNG", () => {
		const path = generateAvatarPath("image/png");
		expect(path).toMatch(/^avatars\/[a-f0-9-]+\.png$/);
	});

	it("should generate unique paths on each call", () => {
		const path1 = generateAvatarPath("image/jpeg");
		const path2 = generateAvatarPath("image/jpeg");
		expect(path1).not.toBe(path2);
	});
});

describe("handleUpload", () => {
	function createEnv(overrides?: Partial<Env>): Env {
		return {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: {} as D1Database,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret",
			KV: createMockKV(),
			R2: createMockR2(),
			...overrides,
		};
	}

	function createMultipartRequest(fields: Record<string, string | File>): Request {
		const formData = new FormData();
		for (const [key, value] of Object.entries(fields)) {
			formData.append(key, value);
		}
		return new Request("https://example.com/api/v1/upload", {
			method: "POST",
			body: formData,
		});
	}

	function createJpegFile(size: number): File {
		const buffer = new ArrayBuffer(size);
		return new File([buffer], "test.jpg", { type: "image/jpeg" });
	}

	function createPngFile(size: number): File {
		const buffer = new ArrayBuffer(size);
		return new File([buffer], "test.png", { type: "image/png" });
	}

	describe("validation", () => {
		it("should reject missing purpose", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = createMultipartRequest({
				file: createJpegFile(1000),
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_PURPOSE");
		});

		it("should reject invalid purpose", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = createMultipartRequest({
				file: createJpegFile(1000),
				purpose: "invalid-purpose",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_PURPOSE");
		});

		it("should reject prototype pollution attempt (purpose=toString)", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = createMultipartRequest({
				file: createJpegFile(1000),
				purpose: "toString",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_PURPOSE");
		});

		it("should reject prototype pollution attempt (purpose=constructor)", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = createMultipartRequest({
				file: createJpegFile(1000),
				purpose: "constructor",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_PURPOSE");
		});

		it("should reject missing file", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = createMultipartRequest({
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("NO_FILE");
		});

		it("should reject file exceeding size limit (200KB)", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const oversizedFile = createJpegFile(250 * 1024); // 250KB
			const request = createMultipartRequest({
				file: oversizedFile,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(413);
			const body = await response.json();
			expect(body.error.code).toBe("FILE_TOO_LARGE");
			expect(body.error.details.maxSize).toBe(200 * 1024);
		});

		it("should reject invalid MIME type (GIF)", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const gifFile = new File([new ArrayBuffer(1000)], "test.gif", { type: "image/gif" });
			const request = createMultipartRequest({
				file: gifFile,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(415);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_FORMAT");
		});

		it("should reject invalid MIME type (WebP)", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const webpFile = new File([new ArrayBuffer(1000)], "test.webp", { type: "image/webp" });
			const request = createMultipartRequest({
				file: webpFile,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(415);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_FORMAT");
		});

		it("should reject invalid multipart form data", async () => {
			const env = createEnv();
			const ctx = createMockCtx();
			const request = new Request("https://example.com/api/v1/upload", {
				method: "POST",
				headers: { "Content-Type": "multipart/form-data" },
				body: "invalid body",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});
	});

	describe("avatar upload success", () => {
		it("should upload JPEG to R2 with GUID path and update database", async () => {
			const r2 = createMockR2();
			const { db, calls } = createMockDb();
			const env = createEnv({ R2: r2, DB: db });
			const ctx = createMockCtx();
			const file = createJpegFile(5000);
			const request = createMultipartRequest({
				file,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 12345);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.url).toBe("/api/avatar/12345");
			expect(body.data.size).toBe(5000);
			// path should be GUID-based
			expect(body.data.path).toMatch(/^avatars\/[a-f0-9-]+\.jpg$/);

			// Verify R2 put was called with GUID-based key
			expect(r2._putCalls).toHaveLength(1);
			expect(r2._putCalls[0].key).toMatch(/^avatars\/[a-f0-9-]+\.jpg$/);
			expect(r2._putCalls[0].options?.httpMetadata?.contentType).toBe("image/jpeg");

			// Verify DB update includes avatar_path
			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET avatar_path"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toContain(12345);
		});

		it("should upload PNG to R2 with correct MIME type and extension", async () => {
			const r2 = createMockR2();
			const { db } = createMockDb();
			const env = createEnv({ R2: r2, DB: db });
			const ctx = createMockCtx();
			const file = createPngFile(10000);
			const request = createMultipartRequest({
				file,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.path).toMatch(/^avatars\/[a-f0-9-]+\.png$/);

			expect(r2._putCalls).toHaveLength(1);
			expect(r2._putCalls[0].key).toMatch(/^avatars\/[a-f0-9-]+\.png$/);
			expect(r2._putCalls[0].options?.httpMetadata?.contentType).toBe("image/png");
		});

		it("should accept file at exactly 200KB limit", async () => {
			const r2 = createMockR2();
			const { db } = createMockDb();
			const env = createEnv({ R2: r2, DB: db });
			const ctx = createMockCtx();
			const file = createJpegFile(200 * 1024); // exactly 200KB
			const request = createMultipartRequest({
				file,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(200);
		});

		it("should trigger cache invalidation", async () => {
			const r2 = createMockR2();
			const { db } = createMockDb();
			const kv = createMockKV();
			const env = createEnv({ R2: r2, DB: db, KV: kv });
			const ctx = createMockCtx();
			const file = createJpegFile(5000);
			const request = createMultipartRequest({
				file,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(200);
			// waitUntil should have been called for cache invalidation
			expect(ctx._waitUntilPromises).toHaveLength(1);
		});

		it("should generate unique paths for consecutive uploads", async () => {
			const r2 = createMockR2();
			const { db } = createMockDb();
			const env = createEnv({ R2: r2, DB: db });
			const ctx = createMockCtx();
			const file1 = createJpegFile(1000);
			const file2 = createJpegFile(1000);

			await handleUpload(createMultipartRequest({ file: file1, purpose: "avatar" }), env, ctx, 42);
			await handleUpload(createMultipartRequest({ file: file2, purpose: "avatar" }), env, ctx, 42);

			expect(r2._putCalls).toHaveLength(2);
			expect(r2._putCalls[0].key).not.toBe(r2._putCalls[1].key);
		});
	});

	describe("R2 error handling", () => {
		it("should return 500 on R2 upload failure", async () => {
			const r2 = createMockR2({ putError: new Error("R2 connection failed") });
			const { db } = createMockDb();
			const env = createEnv({ R2: r2, DB: db });
			const ctx = createMockCtx();
			const file = createJpegFile(5000);
			const request = createMultipartRequest({
				file,
				purpose: "avatar",
			});

			const response = await handleUpload(request, env, ctx, 42);

			expect(response.status).toBe(500);
			const body = await response.json();
			expect(body.error.code).toBe("UPLOAD_FAILED");
			expect(body.error.details.message).toBe("R2 connection failed");
		});
	});
});
