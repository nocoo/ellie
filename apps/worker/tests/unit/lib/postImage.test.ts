import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/lib/env";
import {
	generatePostImagePath,
	handleGetPostImage,
	handlePostImageUpload,
	POST_IMAGE_PREFIX,
	validatePostImageKey,
} from "../../../src/lib/postImage";
import { createMockR2 } from "../../helpers";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function makeEnv(r2: R2Bucket): Env {
	return {
		API_KEY: "k",
		ADMIN_API_KEY: "k",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "s",
		KV: {} as KVNamespace,
		R2: r2,
	};
}

describe("generatePostImagePath", () => {
	it("uses jpg ext for image/jpeg", () => {
		expect(generatePostImagePath("image/jpeg")).toMatch(
			new RegExp(`^${POST_IMAGE_PREFIX}[a-f0-9-]+\\.jpg$`),
		);
	});

	it("uses png ext for image/png", () => {
		expect(generatePostImagePath("image/png")).toMatch(
			new RegExp(`^${POST_IMAGE_PREFIX}[a-f0-9-]+\\.png$`),
		);
	});

	it("uses webp ext for image/webp", () => {
		expect(generatePostImagePath("image/webp")).toMatch(/\.webp$/);
	});

	it("uses gif ext for image/gif", () => {
		expect(generatePostImagePath("image/gif")).toMatch(/\.gif$/);
	});

	it("falls back to jpg for unknown mime", () => {
		expect(generatePostImagePath("image/unknown")).toMatch(/\.jpg$/);
	});

	it("generates unique paths", () => {
		const a = generatePostImagePath("image/png");
		const b = generatePostImagePath("image/png");
		expect(a).not.toBe(b);
	});
});

describe("validatePostImageKey", () => {
	it("accepts uuid.jpg", () => {
		const r = validatePostImageKey(`${VALID_UUID}.jpg`);
		expect(r).toEqual({ key: `${POST_IMAGE_PREFIX}${VALID_UUID}.jpg`, mime: "image/jpeg" });
	});

	it("accepts uuid.jpeg", () => {
		const r = validatePostImageKey(`${VALID_UUID}.jpeg`);
		expect(r?.mime).toBe("image/jpeg");
	});

	it("accepts uuid.png", () => {
		expect(validatePostImageKey(`${VALID_UUID}.png`)?.mime).toBe("image/png");
	});

	it("accepts uuid.webp", () => {
		expect(validatePostImageKey(`${VALID_UUID}.webp`)?.mime).toBe("image/webp");
	});

	it("accepts uuid.gif", () => {
		expect(validatePostImageKey(`${VALID_UUID}.gif`)?.mime).toBe("image/gif");
	});

	it("normalizes ext case", () => {
		expect(validatePostImageKey(`${VALID_UUID}.JPG`)?.mime).toBe("image/jpeg");
	});

	it("rejects empty", () => {
		expect(validatePostImageKey("")).toBeNull();
	});

	it("rejects path traversal '..'", () => {
		expect(validatePostImageKey("..")).toBeNull();
		expect(validatePostImageKey(`../${VALID_UUID}.jpg`)).toBeNull();
		expect(validatePostImageKey(`${VALID_UUID}..jpg`)).toBeNull();
	});

	it("rejects double slash", () => {
		expect(validatePostImageKey(`foo//${VALID_UUID}.jpg`)).toBeNull();
	});

	it("rejects backslash", () => {
		expect(validatePostImageKey(`foo\\${VALID_UUID}.jpg`)).toBeNull();
	});

	it("rejects leading slash", () => {
		expect(validatePostImageKey(`/${VALID_UUID}.jpg`)).toBeNull();
	});

	it("rejects trailing slash", () => {
		expect(validatePostImageKey(`${VALID_UUID}.jpg/`)).toBeNull();
	});

	it("rejects nested path (any slash)", () => {
		expect(validatePostImageKey(`sub/${VALID_UUID}.jpg`)).toBeNull();
	});

	it("rejects with prefix already present", () => {
		expect(validatePostImageKey(`${POST_IMAGE_PREFIX}${VALID_UUID}.jpg`)).toBeNull();
	});

	it("rejects non-UUID basename", () => {
		expect(validatePostImageKey("not-a-uuid.jpg")).toBeNull();
		expect(validatePostImageKey("12345.jpg")).toBeNull();
	});

	it("rejects non-whitelisted ext", () => {
		expect(validatePostImageKey(`${VALID_UUID}.svg`)).toBeNull();
		expect(validatePostImageKey(`${VALID_UUID}.html`)).toBeNull();
		expect(validatePostImageKey(`${VALID_UUID}.exe`)).toBeNull();
	});

	it("rejects no ext", () => {
		expect(validatePostImageKey(VALID_UUID)).toBeNull();
	});

	it("rejects ext-only", () => {
		expect(validatePostImageKey(".jpg")).toBeNull();
	});

	it("rejects basename ending in dot", () => {
		expect(validatePostImageKey(`${VALID_UUID}.`)).toBeNull();
	});
});

describe("handlePostImageUpload", () => {
	it("writes R2 with sniffed contentType and returns canonical url", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const data = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]).buffer;

		const res = await handlePostImageUpload(env, data, "image/jpeg");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { url: string; path: string; size: number; contentType: string };
		};

		expect(body.data.path).toMatch(new RegExp(`^${POST_IMAGE_PREFIX}[a-f0-9-]+\\.jpg$`));
		expect(body.data.url).toBe(`/api/post-image/${body.data.path.slice(POST_IMAGE_PREFIX.length)}`);
		expect(body.data.size).toBe(6);
		expect(body.data.contentType).toBe("image/jpeg");

		expect((r2 as any)._putCalls).toHaveLength(1);
		expect((r2 as any)._putCalls[0].options.httpMetadata.contentType).toBe("image/jpeg");
	});

	it("returns 500 on R2 failure", async () => {
		const r2 = createMockR2({ putError: new Error("boom") });
		const env = makeEnv(r2);
		const res = await handlePostImageUpload(env, new ArrayBuffer(8), "image/png");
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: { code: string; details: { message: string } } };
		expect(body.error.code).toBe("UPLOAD_FAILED");
		expect(body.error.details.message).toBe("boom");
	});
});

describe("handleGetPostImage", () => {
	it("returns 404 on invalid path", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const res = await handleGetPostImage("../etc/passwd", env);
		expect(res.status).toBe(404);
	});

	it("returns 404 on R2 miss", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const res = await handleGetPostImage(`${VALID_UUID}.jpg`, env);
		expect(res.status).toBe(404);
	});

	it("404 on wrong-prefix path (caller cannot pass full key)", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const res = await handleGetPostImage(`${POST_IMAGE_PREFIX}${VALID_UUID}.jpg`, env);
		expect(res.status).toBe(404);
	});

	it("404 on non-whitelisted ext", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const res = await handleGetPostImage(`${VALID_UUID}.svg`, env);
		expect(res.status).toBe(404);
	});

	it("returns object with extension-derived contentType + nosniff + immutable cache", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		const data = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
		await env.R2.put(`${POST_IMAGE_PREFIX}${VALID_UUID}.jpg`, data, {
			httpMetadata: { contentType: "image/jpeg" },
		});

		const res = await handleGetPostImage(`${VALID_UUID}.jpg`, env);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
	});

	it("ignores R2-stored contentType and uses ext-derived MIME (defense against text/html injection)", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		// Pretend a previous bug or admin write stored a malicious metadata
		await env.R2.put(`${POST_IMAGE_PREFIX}${VALID_UUID}.jpg`, new ArrayBuffer(8), {
			httpMetadata: { contentType: "text/html" },
		});

		const res = await handleGetPostImage(`${VALID_UUID}.jpg`, env);
		expect(res.status).toBe(200);
		// Must be image/jpeg from extension, NOT text/html from metadata
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("uses ext-derived MIME when stored contentType is missing", async () => {
		const r2 = createMockR2();
		const env = makeEnv(r2);
		// put without httpMetadata
		await env.R2.put(`${POST_IMAGE_PREFIX}${VALID_UUID}.png`, new ArrayBuffer(8));

		const res = await handleGetPostImage(`${VALID_UUID}.png`, env);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
	});
});
