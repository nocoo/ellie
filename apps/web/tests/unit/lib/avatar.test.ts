import { describe, expect, it } from "vitest";
import { getAvatarUrl } from "@/lib/avatar";
import { FALLBACK_URL } from "@/lib/avatar-proxy";

describe("getAvatarUrl", () => {
	it("resolves unknown paths through the revalidating proxy", () => {
		expect(getAvatarUrl(12345)).toBe("/api/avatar/12345?v=current");
		expect(getAvatarUrl(42, undefined, 1712345678000)).toBe("/api/avatar/42?v=1712345678000");
	});

	it.each(["", null])("uses direct legacy CDN access for known empty paths (%s)", (path) => {
		expect(getAvatarUrl(12345, path)).toBe("https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg");
	});

	it("uses the uploaded GUID path directly", () => {
		expect(getAvatarUrl(42, "avatars/abc123.jpg")).toBe("https://t.no.mt/avatars/abc123.jpg");
	});

	it("applies explicit cache versions to both known path formats", () => {
		expect(getAvatarUrl(42, "avatars/xyz.jpg", 1712345678000)).toBe(
			"https://t.no.mt/avatars/xyz.jpg?v=1712345678000",
		);
		expect(getAvatarUrl(42, "", 1712345678000)).toBe(
			"https://t.no.mt/avatar/000/00/00/42_avatar_big.jpg?v=1712345678000",
		);
	});

	it.each([0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
		"uses static fallback for anonymous or invalid UID %s",
		(uid) => {
			expect(getAvatarUrl(uid)).toBe(FALLBACK_URL);
			expect(getAvatarUrl(uid, "avatars/hidden.jpg")).toBe(FALLBACK_URL);
		},
	);
});
