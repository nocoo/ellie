import { describe, expect, it } from "vitest";
import {
	FALLBACK_AVATAR_URL,
	getAttachmentThumbUrl,
	getAttachmentUrl,
	getSmileyUrl,
	getStaticImageUrl,
	getUserAvatarUrl,
} from "@/lib/cdn";

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

	describe("getUserAvatarUrl", () => {
		it.each(["avatars/abc.jpg", "avatar/000/01/23/45_avatar_big.jpg"])(
			"uses the stored key directly: %s",
			(path) => {
				expect(getUserAvatarUrl(path)).toBe(`https://t.no.mt/${path}`);
			},
		);
		it("uses a local default for an explicitly empty path", () => {
			expect(getUserAvatarUrl("")).toBe(FALLBACK_AVATAR_URL);
			expect(FALLBACK_AVATAR_URL).toBe("/default-avatar.gif");
		});
		it.each([null, undefined])("rejects incomplete payloads: %s", (path) => {
			expect(() => Reflect.apply(getUserAvatarUrl, null, [path])).toThrow(
				"Avatar path is required",
			);
		});
	});
});
