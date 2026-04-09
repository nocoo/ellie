import { describe, expect, test } from "bun:test";
import {
	CDN_BASE,
	FALLBACK_URL,
	computeAvatarCdnPath,
	getCacheControl,
} from "../../../src/lib/avatar-proxy";

describe("avatar-proxy", () => {
	describe("constants", () => {
		test("CDN_BASE points to t.no.mt", () => {
			expect(CDN_BASE).toBe("https://t.no.mt/avatar");
		});

		test("FALLBACK_URL points to default avatar GIF", () => {
			expect(FALLBACK_URL).toBe("https://t.no.mt/static/image/common/tavatar.gif");
		});
	});

	describe("computeAvatarCdnPath", () => {
		test("generates correct path for UID 12345", () => {
			expect(computeAvatarCdnPath(12345)).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});

		test("generates correct path for UID 1", () => {
			expect(computeAvatarCdnPath(1)).toBe(
				"https://t.no.mt/avatar/000/00/00/01_avatar_big.jpg",
			);
		});

		test("generates correct path for large UID", () => {
			expect(computeAvatarCdnPath(123456789)).toBe(
				"https://t.no.mt/avatar/123/45/67/89_avatar_big.jpg",
			);
		});

		test("handles UID 0", () => {
			expect(computeAvatarCdnPath(0)).toBe(
				"https://t.no.mt/avatar/000/00/00/00_avatar_big.jpg",
			);
		});
	});

	describe("getCacheControl", () => {
		describe("with version param (fresh upload)", () => {
			test("returns no-cache for normal avatar", () => {
				expect(getCacheControl(true, false)).toBe("public, max-age=0, must-revalidate");
			});

			test("returns no-cache for fallback (critical: prevents caching stale fallback)", () => {
				// This is the key fix: when ?v= is present but CDN hasn't propagated,
				// we must NOT cache the fallback GIF
				expect(getCacheControl(true, true)).toBe("public, max-age=0, must-revalidate");
			});
		});

		describe("without version param (normal request)", () => {
			test("returns 7-day cache for normal avatar", () => {
				expect(getCacheControl(false, false)).toBe("public, max-age=604800");
			});

			test("returns 1-day cache for fallback", () => {
				expect(getCacheControl(false, true)).toBe("public, max-age=86400");
			});
		});

		describe("cache duration values", () => {
			test("7-day cache equals 604800 seconds", () => {
				// 7 * 24 * 60 * 60 = 604800
				expect(7 * 24 * 60 * 60).toBe(604800);
			});

			test("1-day cache equals 86400 seconds", () => {
				// 24 * 60 * 60 = 86400
				expect(24 * 60 * 60).toBe(86400);
			});
		});
	});
});
