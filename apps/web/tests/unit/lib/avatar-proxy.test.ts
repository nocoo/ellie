import { describe, expect, it } from "vitest";
import {
	CDN_BASE,
	computeAvatarCdnPath,
	computeLegacyAvatarCdnPath,
	FALLBACK_URL,
} from "@/lib/avatar-proxy";

describe("avatar-proxy", () => {
	describe("constants", () => {
		it("CDN_BASE points to t.no.mt", () => {
			expect(CDN_BASE).toBe("https://t.no.mt");
		});

		it("FALLBACK_URL points to default avatar GIF", () => {
			expect(FALLBACK_URL).toBe("https://t.no.mt/static/image/common/tavatar.gif");
		});
	});

	describe("computeLegacyAvatarCdnPath", () => {
		it("generates correct path for UID 12345", () => {
			expect(computeLegacyAvatarCdnPath(12345)).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});

		it("generates correct path for UID 1", () => {
			expect(computeLegacyAvatarCdnPath(1)).toBe(
				"https://t.no.mt/avatar/000/00/00/01_avatar_big.jpg",
			);
		});

		it("generates correct path for large UID", () => {
			expect(computeLegacyAvatarCdnPath(123456789)).toBe(
				"https://t.no.mt/avatar/123/45/67/89_avatar_big.jpg",
			);
		});

		it("handles UID 0", () => {
			expect(computeLegacyAvatarCdnPath(0)).toBe(
				"https://t.no.mt/avatar/000/00/00/00_avatar_big.jpg",
			);
		});
	});

	describe("computeAvatarCdnPath", () => {
		it("uses avatarPath when provided", () => {
			expect(computeAvatarCdnPath(12345, "avatars/abc123.jpg")).toBe(
				"https://t.no.mt/avatars/abc123.jpg",
			);
		});

		it("falls back to legacy path when avatarPath is empty", () => {
			expect(computeAvatarCdnPath(12345, "")).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});

		it("falls back to legacy path when avatarPath is undefined", () => {
			expect(computeAvatarCdnPath(12345)).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});
	});
});
