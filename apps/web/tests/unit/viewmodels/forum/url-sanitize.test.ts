import { sanitizeUrl } from "@/viewmodels/forum/url-sanitize";
import { describe, expect, it } from "vitest";

describe("sanitizeUrl", () => {
	describe("dangerous schemes — must reject", () => {
		it("rejects javascript:", () => {
			expect(sanitizeUrl("javascript:alert(1)").url).toBeNull();
		});

		it("rejects javascript: with leading whitespace", () => {
			expect(sanitizeUrl("  javascript:alert(1)").url).toBeNull();
		});

		it("rejects mixed-case JaVaScRiPt:", () => {
			expect(sanitizeUrl("JaVaScRiPt:alert(1)").url).toBeNull();
		});

		it("rejects javascript: hidden by control chars (TAB inside scheme)", () => {
			// `\tjava\tscript:alert(1)` — browsers ignore the TABs and execute as javascript:
			expect(sanitizeUrl("java\tscript:alert(1)").url).toBeNull();
		});

		it("rejects javascript: hidden by leading newline", () => {
			expect(sanitizeUrl("\njavascript:alert(1)").url).toBeNull();
		});

		it("rejects data: URLs", () => {
			expect(sanitizeUrl("data:text/html,<script>alert(1)</script>").url).toBeNull();
		});

		it("rejects vbscript:", () => {
			expect(sanitizeUrl("vbscript:msgbox(1)").url).toBeNull();
		});

		it("rejects file:", () => {
			expect(sanitizeUrl("file:///etc/passwd").url).toBeNull();
		});
	});

	describe("allowed schemes", () => {
		it("accepts http://", () => {
			expect(sanitizeUrl("http://example.com").url).toBe("http://example.com");
		});

		it("accepts https://", () => {
			expect(sanitizeUrl("https://example.com/path?q=1").url).toBe("https://example.com/path?q=1");
		});

		it("accepts mailto:", () => {
			expect(sanitizeUrl("mailto:a@b.com").url).toBe("mailto:a@b.com");
		});

		it("accepts tel:", () => {
			expect(sanitizeUrl("tel:+18005551234").url).toBe("tel:+18005551234");
		});

		it("accepts protocol-relative //", () => {
			expect(sanitizeUrl("//cdn.example.com/img.png").url).toBe("//cdn.example.com/img.png");
		});

		it("accepts same-page anchor #frag", () => {
			expect(sanitizeUrl("#section").url).toBe("#section");
		});

		it("rejects unknown allowed-but-not-on-list scheme (ftp:)", () => {
			expect(sanitizeUrl("ftp://files.example.com/").url).toBeNull();
		});
	});

	describe("schemeless input", () => {
		it("prepends https:// to bare host", () => {
			expect(sanitizeUrl("example.com").url).toBe("https://example.com");
		});

		it("prepends https:// to host + path", () => {
			expect(sanitizeUrl("example.com/foo/bar").url).toBe("https://example.com/foo/bar");
		});

		it("rejects schemeless input with spaces", () => {
			expect(sanitizeUrl("evil example.com").url).toBeNull();
		});
	});

	describe("empty / non-string", () => {
		it("rejects empty string", () => {
			expect(sanitizeUrl("").url).toBeNull();
		});

		it("rejects whitespace-only", () => {
			expect(sanitizeUrl("   ").url).toBeNull();
		});

		it("rejects non-string input", () => {
			expect(sanitizeUrl(undefined).url).toBeNull();
			expect(sanitizeUrl(null).url).toBeNull();
			expect(sanitizeUrl(42).url).toBeNull();
		});
	});
});
