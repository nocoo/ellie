import { describe, expect, test } from "bun:test";
import {
	SMILEY_SIZE,
	countSmileys,
	extractSmileyFilename,
	extractSmileyPack,
	extractSmileyUrls,
	isSmileyUrl,
	smileyClassName,
} from "@/viewmodels/forum/smiley";

describe("smiley ViewModel", () => {
	describe("isSmileyUrl", () => {
		test("accepts valid smiley path (gif)", () => {
			expect(isSmileyUrl("/smileys/default/smile.gif")).toBe(true);
		});

		test("accepts valid smiley path (png)", () => {
			expect(isSmileyUrl("/smileys/coolmonkey/001.png")).toBe(true);
		});

		test("accepts valid smiley path (jpg)", () => {
			expect(isSmileyUrl("/smileys/soso/e113.jpg")).toBe(true);
		});

		test("accepts valid smiley path (jpeg)", () => {
			expect(isSmileyUrl("/smileys/default/test.jpeg")).toBe(true);
		});

		test("rejects non-smiley path", () => {
			expect(isSmileyUrl("/images/avatar.png")).toBe(false);
		});

		test("rejects external URL", () => {
			expect(isSmileyUrl("https://evil.com/smileys/default/smile.gif")).toBe(false);
		});

		test("rejects path traversal", () => {
			expect(isSmileyUrl("/smileys/../etc/passwd")).toBe(false);
		});

		test("rejects double slashes", () => {
			expect(isSmileyUrl("/smileys//default/smile.gif")).toBe(false);
		});

		test("rejects path without extension", () => {
			expect(isSmileyUrl("/smileys/default/smile")).toBe(false);
		});

		test("rejects disallowed extension", () => {
			expect(isSmileyUrl("/smileys/default/smile.svg")).toBe(false);
		});

		test("rejects empty string", () => {
			expect(isSmileyUrl("")).toBe(false);
		});
	});

	describe("extractSmileyPack", () => {
		test("extracts default pack", () => {
			expect(extractSmileyPack("/smileys/default/smile.gif")).toBe("default");
		});

		test("extracts soso pack", () => {
			expect(extractSmileyPack("/smileys/soso/e113.gif")).toBe("soso");
		});

		test("extracts coolmonkey pack", () => {
			expect(extractSmileyPack("/smileys/coolmonkey/001.gif")).toBe("coolmonkey");
		});

		test("returns null for invalid url", () => {
			expect(extractSmileyPack("/images/avatar.png")).toBeNull();
		});

		test("returns null for smiley root without filename", () => {
			expect(extractSmileyPack("/smileys/smile.gif")).toBeNull();
		});
	});

	describe("extractSmileyFilename", () => {
		test("extracts filename", () => {
			expect(extractSmileyFilename("/smileys/default/smile.gif")).toBe("smile.gif");
		});

		test("extracts filename from nested path", () => {
			expect(extractSmileyFilename("/smileys/soso/e113.gif")).toBe("e113.gif");
		});

		test("returns null for invalid url", () => {
			expect(extractSmileyFilename("/images/avatar.png")).toBeNull();
		});
	});

	describe("countSmileys", () => {
		test("counts zero in plain text", () => {
			expect(countSmileys("Hello world")).toBe(0);
		});

		test("counts one smiley", () => {
			const html = '<p>Hi <img src="/smileys/default/smile.gif" alt=":)" class="smiley" /></p>';
			expect(countSmileys(html)).toBe(1);
		});

		test("counts multiple smileys", () => {
			const html =
				'<p><img src="/smileys/default/smile.gif" alt=":)" class="smiley" /> ' +
				'Hello <img src="/smileys/default/biggrin.gif" alt=":D" class="smiley" /></p>';
			expect(countSmileys(html)).toBe(2);
		});

		test("does not count non-smiley images", () => {
			const html = '<p><img src="/images/avatar.png" alt="avatar" /></p>';
			expect(countSmileys(html)).toBe(0);
		});
	});

	describe("extractSmileyUrls", () => {
		test("extracts urls from html", () => {
			const html =
				'<p><img src="/smileys/default/smile.gif" class="smiley" /> ' +
				'<img src="/smileys/soso/e113.gif" alt="soso" /></p>';
			const urls = extractSmileyUrls(html);
			expect(urls).toEqual(["/smileys/default/smile.gif", "/smileys/soso/e113.gif"]);
		});

		test("returns empty array for no smileys", () => {
			expect(extractSmileyUrls("<p>Hello</p>")).toEqual([]);
		});

		test("skips invalid smiley paths", () => {
			const html = '<img src="/smileys/../etc/passwd" />';
			expect(extractSmileyUrls(html)).toEqual([]);
		});
	});

	describe("SMILEY_SIZE", () => {
		test("has width and height", () => {
			expect(SMILEY_SIZE.width).toBe(24);
			expect(SMILEY_SIZE.height).toBe(24);
		});
	});

	describe("smileyClassName", () => {
		test("includes smiley class", () => {
			expect(smileyClassName()).toContain("smiley");
		});

		test("includes inline-block for flow layout", () => {
			expect(smileyClassName()).toContain("inline-block");
		});
	});
});
