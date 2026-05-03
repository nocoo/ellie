import { describe, expect, it } from "vitest";
import { sniffImageType } from "../../../src/lib/imageMagicBytes";

function bufFromBytes(bytes: number[]): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

describe("sniffImageType", () => {
	describe("JPEG", () => {
		it("should detect JPEG signature (FF D8 FF)", () => {
			expect(sniffImageType(bufFromBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("image/jpeg");
		});

		it("should detect JPEG with minimum 3 bytes", () => {
			expect(sniffImageType(bufFromBytes([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
		});

		it("should reject truncated JPEG (2 bytes)", () => {
			expect(sniffImageType(bufFromBytes([0xff, 0xd8]))).toBeNull();
		});
	});

	describe("PNG", () => {
		it("should detect full PNG signature", () => {
			expect(
				sniffImageType(bufFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
			).toBe("image/png");
		});

		it("should reject PNG with one wrong byte", () => {
			expect(
				sniffImageType(bufFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])),
			).toBeNull();
		});

		it("should reject truncated PNG", () => {
			expect(sniffImageType(bufFromBytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		});
	});

	describe("GIF", () => {
		it("should detect GIF87a", () => {
			expect(sniffImageType(bufFromBytes([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe("image/gif");
		});

		it("should detect GIF89a", () => {
			expect(sniffImageType(bufFromBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
		});

		it("should reject GIF with wrong version byte", () => {
			expect(sniffImageType(bufFromBytes([0x47, 0x49, 0x46, 0x38, 0x38, 0x61]))).toBeNull();
		});
	});

	describe("WebP", () => {
		it("should detect WebP (RIFF...WEBP)", () => {
			expect(
				sniffImageType(
					bufFromBytes([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
				),
			).toBe("image/webp");
		});

		it("should reject RIFF without WEBP marker", () => {
			expect(
				sniffImageType(
					bufFromBytes([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]),
				),
			).toBeNull();
		});

		it("should reject truncated WebP (11 bytes)", () => {
			expect(
				sniffImageType(
					bufFromBytes([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42]),
				),
			).toBeNull();
		});
	});

	describe("rejection", () => {
		it("should return null for empty buffer", () => {
			expect(sniffImageType(new ArrayBuffer(0))).toBeNull();
		});

		it("should return null for arbitrary bytes", () => {
			expect(
				sniffImageType(bufFromBytes([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])),
			).toBeNull();
		});

		it("should return null for SVG-ish text (starts with <)", () => {
			expect(
				sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">').buffer),
			).toBeNull();
		});

		it("should return null for HTML", () => {
			expect(
				sniffImageType(new TextEncoder().encode("<html><body></body></html>").buffer),
			).toBeNull();
		});
	});
});
