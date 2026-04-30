import { describe, expect, it } from "vitest";
import { UPLOAD_CONFIGS } from "../../../src/lib/upload-config";

describe("UPLOAD_CONFIGS", () => {
	describe("avatar config", () => {
		it("should limit avatar size to 200KB", () => {
			expect(UPLOAD_CONFIGS.avatar.maxSize).toBe(200 * 1024);
		});

		it("should allow only JPEG and PNG", () => {
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).toContain("image/jpeg");
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).toContain("image/png");
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).toHaveLength(2);
		});

		it("should not allow GIF", () => {
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).not.toContain("image/gif");
		});

		it("should not allow WebP", () => {
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).not.toContain("image/webp");
		});

		it("should not allow SVG", () => {
			expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).not.toContain("image/svg+xml");
		});
	});

	describe("config validation", () => {
		it("should have positive maxSize for all configs", () => {
			for (const [_purpose, config] of Object.entries(UPLOAD_CONFIGS)) {
				expect(config.maxSize).toBeGreaterThan(0);
			}
		});

		it("should have at least one allowed MIME type for all configs", () => {
			for (const [_purpose, config] of Object.entries(UPLOAD_CONFIGS)) {
				expect(config.allowedMimeTypes.length).toBeGreaterThan(0);
			}
		});

		it("should have valid image MIME types", () => {
			const validImageMimeTypes = [
				"image/jpeg",
				"image/png",
				"image/gif",
				"image/webp",
				"image/svg+xml",
				"image/bmp",
				"image/tiff",
			];
			for (const config of Object.values(UPLOAD_CONFIGS)) {
				for (const mimeType of config.allowedMimeTypes) {
					expect(validImageMimeTypes).toContain(mimeType);
				}
			}
		});
	});
});
