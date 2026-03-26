import { describe, expect, test } from "bun:test";
import {
	attachmentUrl,
	isDangerousAttribute,
	isForbiddenTag,
	isSafeUrl,
	sanitizeCssProperty,
	thumbnailUrl,
} from "@/lib/attachment";

// ─── attachmentUrl ──────────────────────────────────────

describe("attachmentUrl", () => {
	test("produces correct URL with default R2 base", () => {
		const url = attachmentUrl("attachments/2024/01/photo.jpg");
		expect(url).toBe("https://r2.example.com/attachments/2024/01/photo.jpg");
	});

	test("handles empty filePath", () => {
		const url = attachmentUrl("");
		expect(url).toBe("https://r2.example.com/");
	});
});

// ─── thumbnailUrl ───────────────────────────────────────

describe("thumbnailUrl", () => {
	test("appends .thumb.jpg to filePath", () => {
		const url = thumbnailUrl("attachments/2024/01/photo.jpg");
		expect(url).toBe("https://r2.example.com/attachments/2024/01/photo.jpg.thumb.jpg");
	});
});

// ─── isSafeUrl ──────────────────────────────────────────

describe("isSafeUrl", () => {
	test("https: is safe", () => {
		expect(isSafeUrl("https://example.com/path")).toBe(true);
	});

	test("http: is safe", () => {
		expect(isSafeUrl("http://example.com")).toBe(true);
	});

	test("ftp: is safe", () => {
		expect(isSafeUrl("ftp://files.example.com")).toBe(true);
	});

	test("mailto: is safe", () => {
		expect(isSafeUrl("mailto:user@example.com")).toBe(true);
	});

	test("relative path / is safe", () => {
		expect(isSafeUrl("/path/to/page")).toBe(true);
	});

	test("relative path ./ is safe", () => {
		expect(isSafeUrl("./image.png")).toBe(true);
	});

	test("anchor # is safe", () => {
		expect(isSafeUrl("#section")).toBe(true);
	});

	test("javascript: is dangerous", () => {
		expect(isSafeUrl("javascript:alert(1)")).toBe(false);
	});

	test("data: is dangerous", () => {
		expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
	});

	test("vbscript: is dangerous", () => {
		expect(isSafeUrl("vbscript:MsgBox")).toBe(false);
	});

	test("whitespace-padded dangerous URL", () => {
		expect(isSafeUrl("  javascript:alert(1)  ")).toBe(false);
	});

	test("bare filename treated as relative (safe)", () => {
		expect(isSafeUrl("image.png")).toBe(true);
	});
});

// ─── isForbiddenTag ─────────────────────────────────────

describe("isForbiddenTag", () => {
	const forbidden = [
		"script",
		"style",
		"iframe",
		"embed",
		"object",
		"applet",
		"form",
		"base",
		"meta",
		"link",
	];
	for (const tag of forbidden) {
		test(`${tag} is forbidden`, () => {
			expect(isForbiddenTag(tag)).toBe(true);
		});
	}

	test("case insensitive", () => {
		expect(isForbiddenTag("SCRIPT")).toBe(true);
		expect(isForbiddenTag("Script")).toBe(true);
	});

	test("allowed tags", () => {
		expect(isForbiddenTag("p")).toBe(false);
		expect(isForbiddenTag("div")).toBe(false);
		expect(isForbiddenTag("img")).toBe(false);
		expect(isForbiddenTag("a")).toBe(false);
		expect(isForbiddenTag("attachment")).toBe(false);
	});
});

// ─── sanitizeCssProperty ────────────────────────────────

describe("sanitizeCssProperty", () => {
	// color
	test("color: hex 6-digit", () => {
		expect(sanitizeCssProperty("color", "#FF0000")).toBe("#FF0000");
	});

	test("color: hex 3-digit", () => {
		expect(sanitizeCssProperty("color", "#F00")).toBe("#F00");
	});

	test("color: named color", () => {
		expect(sanitizeCssProperty("color", "red")).toBe("red");
	});

	test("color: rgb()", () => {
		expect(sanitizeCssProperty("color", "rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
	});

	test("color: invalid → null", () => {
		expect(sanitizeCssProperty("color", "expression(alert(1))")).toBeNull();
	});

	// font-size
	test("font-size: valid px", () => {
		expect(sanitizeCssProperty("font-size", "14px")).toBe("14px");
	});

	test("font-size: invalid unit → null", () => {
		expect(sanitizeCssProperty("font-size", "14em")).toBeNull();
	});

	// text-align
	test("text-align: left", () => {
		expect(sanitizeCssProperty("text-align", "left")).toBe("left");
	});

	test("text-align: center", () => {
		expect(sanitizeCssProperty("text-align", "center")).toBe("center");
	});

	test("text-align: right", () => {
		expect(sanitizeCssProperty("text-align", "right")).toBe("right");
	});

	test("text-align: justify", () => {
		expect(sanitizeCssProperty("text-align", "justify")).toBe("justify");
	});

	test("text-align: invalid → null", () => {
		expect(sanitizeCssProperty("text-align", "start")).toBeNull();
	});

	// disallowed properties
	test("unknown property → null", () => {
		expect(sanitizeCssProperty("background", "url(evil.png)")).toBeNull();
	});

	test("case insensitive property", () => {
		expect(sanitizeCssProperty("Color", "#000")).toBe("#000");
	});

	test("trims whitespace from value", () => {
		expect(sanitizeCssProperty("color", "  red  ")).toBe("red");
	});
});

// ─── isDangerousAttribute ───────────────────────────────

describe("isDangerousAttribute", () => {
	test("onclick is dangerous", () => {
		expect(isDangerousAttribute("onclick")).toBe(true);
	});

	test("onload is dangerous", () => {
		expect(isDangerousAttribute("onload")).toBe(true);
	});

	test("onerror is dangerous", () => {
		expect(isDangerousAttribute("onerror")).toBe(true);
	});

	test("onmouseover is dangerous", () => {
		expect(isDangerousAttribute("onmouseover")).toBe(true);
	});

	test("case insensitive", () => {
		expect(isDangerousAttribute("OnClick")).toBe(true);
	});

	test("safe attributes", () => {
		expect(isDangerousAttribute("class")).toBe(false);
		expect(isDangerousAttribute("src")).toBe(false);
		expect(isDangerousAttribute("href")).toBe(false);
		expect(isDangerousAttribute("data-aid")).toBe(false);
	});
});
