import { describe, expect, it } from "vitest";
import {
	CDN_BASE,
	computeAvatarCdnPath,
	computeLegacyAvatarCdnPath,
	FALLBACK_URL,
	getCacheControl,
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

	describe("getCacheControl", () => {
		describe("with version param (fresh upload)", () => {
			it("returns no-cache for normal avatar", () => {
				expect(getCacheControl(true, false)).toBe("public, max-age=0, must-revalidate");
			});

			it("returns no-cache for fallback (critical: prevents caching stale fallback)", () => {
				// This is the key fix: when ?v= is present but CDN hasn't propagated,
				// we must NOT cache the fallback GIF
				expect(getCacheControl(true, true)).toBe("public, max-age=0, must-revalidate");
			});
		});

		describe("without version param (normal request)", () => {
			it("returns 7-day cache for normal avatar", () => {
				expect(getCacheControl(false, false)).toBe("public, max-age=604800");
			});

			it("returns 1-day cache for fallback", () => {
				expect(getCacheControl(false, true)).toBe("public, max-age=86400");
			});
		});

		describe("cache duration values", () => {
			it("7-day cache equals 604800 seconds", () => {
				// 7 * 24 * 60 * 60 = 604800
				expect(7 * 24 * 60 * 60).toBe(604800);
			});

			it("1-day cache equals 86400 seconds", () => {
				// 24 * 60 * 60 = 86400
				expect(24 * 60 * 60).toBe(86400);
			});
		});
	});
});
