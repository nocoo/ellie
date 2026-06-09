import { describe, expect, it } from "vitest";
import {
	getAttachmentThumbUrl,
	getAttachmentUrl,
	getSmileyUrl,
	getStaticImageUrl,
} from "@/lib/cdn";

// ---------------------------------------------------------------------------
// getStaticImageUrl
// ---------------------------------------------------------------------------

describe("getStaticImageUrl", () => {
	it("constructs URL under /static/image/common/", () => {
		expect(getStaticImageUrl("logo.png")).toBe("https://t.no.mt/static/image/common/logo.png");
	});

	it("handles filenames with paths", () => {
		expect(getStaticImageUrl("subdir/icon.svg")).toBe(
			"https://t.no.mt/static/image/common/subdir/icon.svg",
		);
	});

	it("handles simple filename", () => {
		expect(getStaticImageUrl("arrow.gif")).toBe("https://t.no.mt/static/image/common/arrow.gif");
	});
});

// ---------------------------------------------------------------------------
// getSmileyUrl
// ---------------------------------------------------------------------------

describe("getSmileyUrl", () => {
	it("constructs URL under /static/image/smiley/{dir}/{file}", () => {
		expect(getSmileyUrl("default", "smile.gif")).toBe(
			"https://t.no.mt/static/image/smiley/default/smile.gif",
		);
	});

	it("handles directory and filename with special chars", () => {
		expect(getSmileyUrl("emoji-set", "laugh.png")).toBe(
			"https://t.no.mt/static/image/smiley/emoji-set/laugh.png",
		);
	});
});

// ---------------------------------------------------------------------------
// getAttachmentUrl
// ---------------------------------------------------------------------------

describe("getAttachmentUrl", () => {
	it("prepends CDN base for relative path without leading slash", () => {
		expect(getAttachmentUrl("forum/202401/01/abc.jpg")).toBe(
			"https://t.no.mt/forum/202401/01/abc.jpg",
		);
	});

	it("prepends CDN base for relative path with leading slash", () => {
		expect(getAttachmentUrl("/forum/202401/01/abc.jpg")).toBe(
			"https://t.no.mt/forum/202401/01/abc.jpg",
		);
	});

	it("returns CDN fallback for external http:// URL (security)", () => {
		// External URLs are rejected for security - returns safe fallback
		expect(getAttachmentUrl("http://example.com/image.jpg")).toBe("https://t.no.mt/");
	});

	it("returns CDN fallback for external https:// URL (security)", () => {
		// External URLs are rejected for security - returns safe fallback
		expect(getAttachmentUrl("https://example.com/image.jpg")).toBe("https://t.no.mt/");
	});

	it("allows absolute URL from CDN host", () => {
		// URLs from the same CDN host are allowed
		expect(getAttachmentUrl("https://t.no.mt/forum/image.jpg")).toBe(
			"https://t.no.mt/forum/image.jpg",
		);
	});

	it("handles path with no directory separators", () => {
		expect(getAttachmentUrl("file.jpg")).toBe("https://t.no.mt/file.jpg");
	});
});

// ---------------------------------------------------------------------------
// getAttachmentThumbUrl
// ---------------------------------------------------------------------------

describe("getAttachmentThumbUrl", () => {
	it("appends .thumb.jpg to relative path", () => {
		expect(getAttachmentThumbUrl("forum/202401/01/abc.jpg")).toBe(
			"https://t.no.mt/forum/202401/01/abc.jpg.thumb.jpg",
		);
	});

	it("appends .thumb.jpg to URL with leading slash", () => {
		expect(getAttachmentThumbUrl("/forum/202401/01/abc.jpg")).toBe(
			"https://t.no.mt/forum/202401/01/abc.jpg.thumb.jpg",
		);
	});

	it("returns CDN fallback with .thumb.jpg for external https URL (security)", () => {
		// External URLs are rejected - returns safe fallback with thumb suffix
		expect(getAttachmentThumbUrl("https://cdn.example.com/image.png")).toBe(
			"https://t.no.mt/.thumb.jpg",
		);
	});

	it("returns CDN fallback with .thumb.jpg for external http URL (security)", () => {
		// External URLs are rejected - returns safe fallback with thumb suffix
		expect(getAttachmentThumbUrl("http://cdn.example.com/img.gif")).toBe(
			"https://t.no.mt/.thumb.jpg",
		);
	});
});
