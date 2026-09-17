import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/upload/route";

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: vi.fn(async () => "test-jwt"),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	vi.stubEnv("AUTH_URL", "https://web.example.com");
	vi.stubEnv("WORKER_API_URL", "https://worker.example.com");
	vi.stubEnv("FORUM_API_KEY", "test-key");
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(Response.json({ data: { url: "/api/avatar/42", size: 1024 } }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function upload(file: File | string | null, purpose = "avatar") {
	const body = new FormData();
	body.set("purpose", purpose);
	if (file !== null) body.set("file", file);
	return POST(
		new Request("https://web.example.com/api/v1/upload", {
			method: "POST",
			headers: { Origin: "https://web.example.com" },
			body,
		}),
	);
}

async function forwardedFile(): Promise<File> {
	expect(fetchMock).toHaveBeenCalledOnce();
	const [url, init] = fetchMock.mock.calls[0];
	expect(url).toBe("https://worker.example.com/api/v1/upload");
	const request = new Request(url, init);
	expect(request.headers.get("Authorization")).toBe("Bearer test-jwt");
	expect(request.headers.get("X-API-Key")).toBe("test-key");
	const file = (await request.formData()).get("file");
	if (!file || typeof file === "string") throw new Error("Missing forwarded image");
	return file;
}

describe("avatar upload compression", () => {
	it.each([
		{ format: "png", width: 720, height: 480, orientation: 1, output: [360, 240] },
		{ format: "jpeg", width: 480, height: 720, orientation: 1, output: [240, 360] },
		{ format: "png", width: 96, height: 64, orientation: 1, output: [96, 64] },
		{ format: "jpeg", width: 720, height: 480, orientation: 6, output: [240, 360] },
	] as const)(
		"encodes $format $width×$height (orientation $orientation) as a bounded quality-80 JPEG",
		async ({ format, width, height, orientation, output }) => {
			const input = await sharp({
				create: { width, height, channels: 3, background: "#408060" },
			})
				.withMetadata({ orientation })
				.toFormat(format)
				.toBuffer();
			const response = await upload(
				new File([new Uint8Array(input)], `original.${format}`, { type: `image/${format}` }),
			);
			expect(response.status).toBe(200);
			const file = await forwardedFile();
			expect(file.type).toBe("image/jpeg");
			expect(file.name).toBe("avatar.jpg");
			const bytes = Buffer.from(await file.arrayBuffer());
			const metadata = await sharp(bytes).metadata();
			expect(metadata.format).toBe("jpeg");
			expect([metadata.width, metadata.height]).toEqual(output);
			expect(metadata.hasAlpha).toBe(false);
			expect(metadata.orientation).toBeUndefined();
			expect(metadata.exif).toBeUndefined();
			// Inspect actual JPEG quantization bytes: IJG luminance table at quality 80.
			const dqt = bytes.indexOf(Buffer.from([0xff, 0xdb]));
			expect(dqt).toBeGreaterThan(0);
			expect([...bytes.subarray(dqt + 4, dqt + 13)]).toEqual([0, 6, 4, 5, 6, 5, 4, 6, 6]);
		},
	);

	it("compresses originals larger than 200 KB below the Worker's storage limit", async () => {
		const input = await sharp(randomBytes(800 * 600 * 3), {
			raw: { width: 800, height: 600, channels: 3 },
		})
			.png()
			.toBuffer();
		expect(input.byteLength).toBeGreaterThan(200 * 1024);
		const response = await upload(
			new File([new Uint8Array(input)], "photo.png", { type: "image/png" }),
		);
		expect(response.status).toBe(200);
		const file = await forwardedFile();
		expect(file.size).toBeLessThan(200 * 1024);
	});

	it("flattens transparent PNG pixels onto white", async () => {
		const input = await sharp({
			create: {
				width: 64,
				height: 64,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.png()
			.toBuffer();
		const response = await upload(
			new File([new Uint8Array(input)], "transparent.png", { type: "image/png" }),
		);
		expect(response.status).toBe(200);
		const file = await forwardedFile();
		const pixels = await sharp(Buffer.from(await file.arrayBuffer()))
			.raw()
			.toBuffer();
		expect([...pixels.subarray(0, 3)]).toEqual([255, 255, 255]);
	});

	it.each([
		["missing file", null, 400, "NO_FILE"],
		["string file", "not a file", 400, "NO_FILE"],
		[
			"oversized original",
			new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
			413,
			"FILE_TOO_LARGE",
		],
		[
			"unsupported MIME",
			new File(["GIF89a"], "x.gif", { type: "image/gif" }),
			415,
			"INVALID_FORMAT",
		],
		["corrupt image", new File(["not PNG"], "x.png", { type: "image/png" }), 415, "INVALID_FORMAT"],
		[
			"SVG disguised as JPEG",
			new File(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'], "x.jpg", {
				type: "image/jpeg",
			}),
			415,
			"INVALID_FORMAT",
		],
	] as const)("rejects %s without contacting the Worker", async (_label, file, status, code) => {
		const response = await upload(file);
		expect(response.status).toBe(status);
		expect(await response.json()).toMatchObject({ error: { code } });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed multipart data", async () => {
		const response = await POST(
			new Request("https://web.example.com/api/v1/upload", {
				method: "POST",
				headers: {
					Origin: "https://web.example.com",
					"Content-Type": "multipart/form-data",
				},
				body: "invalid multipart",
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("preserves post-image bytes, MIME and filename", async () => {
		const input = await sharp({
			create: { width: 720, height: 480, channels: 3, background: "#408060" },
		})
			.png()
			.toBuffer();
		const response = await upload(
			new File([new Uint8Array(input)], "post.png", { type: "image/png" }),
			"post-image",
		);
		expect(response.status).toBe(200);
		const file = await forwardedFile();
		expect(file.type).toBe("image/png");
		expect(file.name).toBe("post.png");
		expect(Buffer.from(await file.arrayBuffer())).toEqual(input);
	});
});
