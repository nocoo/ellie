import {
	FALLBACK_AVATAR_URL,
	computeLegacyAvatarCdnPath,
	getAttachmentThumbUrl,
	getAttachmentUrl,
	getSmileyUrl,
	getStaticImageUrl,
	getUserAvatarUrl,
} from "@/lib/cdn";
import { describe, expect, it } from "vitest";

describe("cdn", () => {
	describe("getStaticImageUrl", () => {
		it("returns full CDN URL for filename", () => {
			expect(getStaticImageUrl("logo.png")).toBe("https://t.no.mt/static/image/common/logo.png");
		});
	});

	describe("getSmileyUrl", () => {
		it("returns CDN smiley URL with directory and filename", () => {
			expect(getSmileyUrl("default", "smile.gif")).toBe(
				"https://t.no.mt/static/image/smiley/default/smile.gif",
			);
		});
	});

	describe("getAttachmentUrl", () => {
		it("prepends CDN base to relative path", () => {
			expect(getAttachmentUrl("forum/2024/file.jpg")).toBe("https://t.no.mt/forum/2024/file.jpg");
		});

		it("handles leading slash", () => {
			expect(getAttachmentUrl("/forum/file.jpg")).toBe("https://t.no.mt/forum/file.jpg");
		});

		it("allows URLs from same CDN host", () => {
			expect(getAttachmentUrl("https://t.no.mt/path/to/file.jpg")).toBe(
				"https://t.no.mt/path/to/file.jpg",
			);
		});

		it("rejects external URLs", () => {
			expect(getAttachmentUrl("https://evil.com/file.jpg")).toBe("https://t.no.mt/");
		});

		it("rejects javascript: protocol", () => {
			expect(getAttachmentUrl("javascript:alert(1)")).toBe("https://t.no.mt/");
		});

		it("rejects data: protocol", () => {
			expect(getAttachmentUrl("data:text/html,<h1>hi</h1>")).toBe("https://t.no.mt/");
		});

		it("rejects vbscript: protocol", () => {
			expect(getAttachmentUrl("vbscript:msgbox")).toBe("https://t.no.mt/");
		});

		it("rejects file: protocol", () => {
			expect(getAttachmentUrl("file:///etc/passwd")).toBe("https://t.no.mt/");
		});

		it("returns fallback for empty/whitespace path", () => {
			expect(getAttachmentUrl("")).toBe("https://t.no.mt/");
			expect(getAttachmentUrl("   ")).toBe("https://t.no.mt/");
		});

		it("sanitizes directory traversal", () => {
			const result = getAttachmentUrl("../../etc/passwd");
			expect(result).not.toContain("..");
		});
	});

	describe("getAttachmentThumbUrl", () => {
		it("appends .thumb.jpg to attachment URL", () => {
			expect(getAttachmentThumbUrl("forum/file.jpg")).toBe(
				"https://t.no.mt/forum/file.jpg.thumb.jpg",
			);
		});
	});

	describe("computeLegacyAvatarCdnPath", () => {
		// Locks the legacy 9-digit zero-padded directory split. Mirrored from
		// apps/web/src/lib/avatar-proxy.ts so admin and forum keep agreeing on
		// where Discuz historically wrote avatars.
		it("zero-pads UID to 9 digits and splits into 3/2/2/2 dirs", () => {
			expect(computeLegacyAvatarCdnPath(12345)).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});

		it("works for small UIDs", () => {
			expect(computeLegacyAvatarCdnPath(1)).toBe(
				"https://t.no.mt/avatar/000/00/00/01_avatar_big.jpg",
			);
		});
	});

	describe("getUserAvatarUrl", () => {
		it("uses GUID-based avatarPath directly when present", () => {
			expect(getUserAvatarUrl(42, "avatars/abc.jpg")).toBe("https://t.no.mt/avatars/abc.jpg");
		});

		it("strips a leading slash from avatarPath to avoid `//`", () => {
			expect(getUserAvatarUrl(42, "/avatars/abc.jpg")).toBe("https://t.no.mt/avatars/abc.jpg");
		});

		it("falls back to legacy UID path when avatarPath is missing/empty/whitespace", () => {
			expect(getUserAvatarUrl(12345)).toBe("https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg");
			expect(getUserAvatarUrl(12345, "")).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
			expect(getUserAvatarUrl(12345, "   ")).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
			expect(getUserAvatarUrl(12345, null)).toBe(
				"https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg",
			);
		});

		it("returns the fallback gif for non-positive UIDs without avatarPath", () => {
			expect(getUserAvatarUrl(0)).toBe(FALLBACK_AVATAR_URL);
			expect(getUserAvatarUrl(-1)).toBe(FALLBACK_AVATAR_URL);
		});
	});
});
