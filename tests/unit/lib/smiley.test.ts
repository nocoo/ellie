import { describe, expect, test } from "bun:test";
import {
	replaceSmileyCodesWithImages,
	NAMED_SMILEY_SET,
	NAMED_SMILEYS,
	coolmonkeyFilename,
	comcomFilename,
	escapeAttr,
} from "@/lib/smiley";

const CDN = "https://t.no.mt/static/image/smiley";

// ── escapeAttr ─────────────────────────────────────────────────────

describe("escapeAttr", () => {
	test("escapes double quotes", () => {
		expect(escapeAttr('a"b')).toBe("a&quot;b");
	});

	test("escapes angle brackets", () => {
		expect(escapeAttr("<script>")).toBe("&lt;script&gt;");
	});

	test("escapes ampersands", () => {
		expect(escapeAttr("a&b")).toBe("a&amp;b");
	});

	test("handles combined special chars", () => {
		expect(escapeAttr('"<>&')).toBe("&quot;&lt;&gt;&amp;");
	});

	test("leaves normal text unchanged", () => {
		expect(escapeAttr(":smile:")).toBe(":smile:");
	});
});

// ── Helper internals ───────────────────────────────────────────────

describe("coolmonkeyFilename", () => {
	test("maps ID 133 → 01.gif", () => {
		expect(coolmonkeyFilename(133)).toBe("01.gif");
	});

	test("maps ID 148 → 16.gif", () => {
		expect(coolmonkeyFilename(148)).toBe("16.gif");
	});

	test("maps ID 140 → 08.gif", () => {
		expect(coolmonkeyFilename(140)).toBe("08.gif");
	});

	test("returns null for out-of-range IDs", () => {
		expect(coolmonkeyFilename(132)).toBeNull();
		expect(coolmonkeyFilename(149)).toBeNull();
		expect(coolmonkeyFilename(0)).toBeNull();
	});

	test("returns null for non-integer IDs", () => {
		expect(coolmonkeyFilename(133.5)).toBeNull();
		expect(coolmonkeyFilename(NaN)).toBeNull();
	});
});

describe("comcomFilename", () => {
	test("maps ID 149 → 1.gif", () => {
		expect(comcomFilename(149)).toBe("1.gif");
	});

	test("maps ID 172 → 24.gif", () => {
		expect(comcomFilename(172)).toBe("24.gif");
	});

	test("maps ID 155 → 7.gif", () => {
		expect(comcomFilename(155)).toBe("7.gif");
	});

	test("returns null for out-of-range IDs", () => {
		expect(comcomFilename(148)).toBeNull();
		expect(comcomFilename(173)).toBeNull();
	});

	test("returns null for non-integer IDs", () => {
		expect(comcomFilename(149.9)).toBeNull();
		expect(comcomFilename(NaN)).toBeNull();
	});
});

// ── Named code mapping ─────────────────────────────────────────────

describe("NAMED_SMILEY_SET", () => {
	test("contains 32 named codes", () => {
		expect(NAMED_SMILEY_SET.size).toBe(32);
	});

	test("contains original 24 codes", () => {
		for (const name of ["smile", "cry", "victory", "lol", "kiss", "biggrin", "mad", "tongue"]) {
			expect(NAMED_SMILEY_SET.has(name)).toBe(true);
		}
	});

	test("contains newly added codes (cool, w00t, wink, angry, etc.)", () => {
		for (const name of ["cool", "w00t", "wink", "angry", "crazy", "dozingoff", "laugh", "rolleyes"]) {
			expect(NAMED_SMILEY_SET.has(name)).toBe(true);
		}
	});

	test("all values end with .gif", () => {
		for (const file of Object.values(NAMED_SMILEYS)) {
			expect(file).toMatch(/\.gif$/);
		}
	});

	test("all values contain only safe filename chars", () => {
		for (const file of Object.values(NAMED_SMILEYS)) {
			expect(file).toMatch(/^[a-z0-9]+\.gif$/);
		}
	});
});

// ── replaceSmileyCodesWithImages ────────────────────────────────────

describe("replaceSmileyCodesWithImages", () => {
	// ── Edge cases ──────────────────────────────────────────────────

	test("returns empty string unchanged", () => {
		expect(replaceSmileyCodesWithImages("")).toBe("");
	});

	test("returns plain text unchanged", () => {
		expect(replaceSmileyCodesWithImages("Hello world")).toBe("Hello world");
	});

	test("returns HTML without smiley codes unchanged", () => {
		const html = '<p>No smileys <a href="#">here</a></p>';
		expect(replaceSmileyCodesWithImages(html)).toBe(html);
	});

	// ── Named codes — alphanumeric ──────────────────────────────────

	test("replaces :smile: with default/smile.gif img", () => {
		const result = replaceSmileyCodesWithImages("Hello :smile: world");
		expect(result).toBe(
			`Hello <img src="${CDN}/default/smile.gif" alt=":smile:" class="smiley" /> world`,
		);
	});

	test("replaces :cry: with default/cry.gif img", () => {
		const result = replaceSmileyCodesWithImages(":cry:");
		expect(result).toBe(`<img src="${CDN}/default/cry.gif" alt=":cry:" class="smiley" />`);
	});

	test("replaces :w00t: (alphanumeric name) with default/w00t.gif", () => {
		const result = replaceSmileyCodesWithImages(":w00t:");
		expect(result).toBe(`<img src="${CDN}/default/w00t.gif" alt=":w00t:" class="smiley" />`);
	});

	test("replaces :cool: with default/cool.gif", () => {
		const result = replaceSmileyCodesWithImages(":cool:");
		expect(result).toBe(`<img src="${CDN}/default/cool.gif" alt=":cool:" class="smiley" />`);
	});

	test("replaces :wink: with default/wink.gif", () => {
		const result = replaceSmileyCodesWithImages(":wink:");
		expect(result).toBe(`<img src="${CDN}/default/wink.gif" alt=":wink:" class="smiley" />`);
	});

	test("replaces :angry: with default/angry.gif", () => {
		const result = replaceSmileyCodesWithImages(":angry:");
		expect(result).toBe(`<img src="${CDN}/default/angry.gif" alt=":angry:" class="smiley" />`);
	});

	test("replaces :rolleyes: with default/rolleyes.gif", () => {
		const result = replaceSmileyCodesWithImages(":rolleyes:");
		expect(result).toBe(
			`<img src="${CDN}/default/rolleyes.gif" alt=":rolleyes:" class="smiley" />`,
		);
	});

	test("replaces multiple named codes", () => {
		const result = replaceSmileyCodesWithImages(":smile::victory:");
		expect(result).toContain("smile.gif");
		expect(result).toContain("victory.gif");
	});

	test("leaves unknown named codes unchanged", () => {
		expect(replaceSmileyCodesWithImages(":unknown:")).toBe(":unknown:");
	});

	// ── Coolmonkey {:2_NNN:} ────────────────────────────────────────

	test("replaces {:2_133:} with coolmonkey/01.gif", () => {
		const result = replaceSmileyCodesWithImages("hey {:2_133:}");
		expect(result).toBe(
			`hey <img src="${CDN}/coolmonkey/01.gif" alt="{:2_133:}" class="smiley" />`,
		);
	});

	test("replaces {:2_148:} with coolmonkey/16.gif", () => {
		const result = replaceSmileyCodesWithImages("{:2_148:}");
		expect(result).toBe(
			`<img src="${CDN}/coolmonkey/16.gif" alt="{:2_148:}" class="smiley" />`,
		);
	});

	test("leaves out-of-range coolmonkey IDs unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:2_132:}")).toBe("{:2_132:}");
		expect(replaceSmileyCodesWithImages("{:2_200:}")).toBe("{:2_200:}");
	});

	// ── Comcom {:3_NNN:} ────────────────────────────────────────────

	test("replaces {:3_149:} with comcom/1.gif", () => {
		const result = replaceSmileyCodesWithImages("{:3_149:}");
		expect(result).toBe(
			`<img src="${CDN}/comcom/1.gif" alt="{:3_149:}" class="smiley" />`,
		);
	});

	test("replaces {:3_172:} with comcom/24.gif", () => {
		const result = replaceSmileyCodesWithImages("{:3_172:}");
		expect(result).toBe(
			`<img src="${CDN}/comcom/24.gif" alt="{:3_172:}" class="smiley" />`,
		);
	});

	test("leaves out-of-range comcom IDs unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:3_148:}")).toBe("{:3_148:}");
		expect(replaceSmileyCodesWithImages("{:3_173:}")).toBe("{:3_173:}");
	});

	// ── Unhandled codes (pass-through) ──────────────────────────────

	test("leaves {:soso_eNNN:} codes unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:soso_e100:}")).toBe("{:soso_e100:}");
	});

	test("leaves {:soso__LONG_N:} codes unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:soso__12345678901234567890_4:}")).toBe(
			"{:soso__12345678901234567890_4:}",
		);
	});

	// ── Normal colons not mistaken for smiley codes ─────────────────

	test("does not replace colons in time strings", () => {
		expect(replaceSmileyCodesWithImages("12:30:00")).toBe("12:30:00");
	});

	test("does not replace colons in URLs", () => {
		const url = "https://example.com";
		expect(replaceSmileyCodesWithImages(url)).toBe(url);
	});

	test("does not replace colons in CSS selectors", () => {
		const css = 'class="text:bold"';
		expect(replaceSmileyCodesWithImages(css)).toBe(css);
	});

	test("does not replace colons around pure numbers", () => {
		expect(replaceSmileyCodesWithImages(":123:")).toBe(":123:");
	});

	// ── Injection prevention ────────────────────────────────────────

	test("escapes HTML in alt attribute for crafted coolmonkey code", () => {
		// A {:2_NNN:} code can't actually contain injection since the regex
		// only captures \d{1,4}, but verify the alt is properly escaped
		const result = replaceSmileyCodesWithImages("{:2_133:}");
		expect(result).toContain('alt="{:2_133:}"');
		expect(result).not.toContain("<script>");
	});

	test("does not process overly long named codes (ReDoS prevention)", () => {
		// Named codes are capped at 20 chars — this 25-char string should pass through
		const longCode = `:${"a".repeat(25)}:`;
		expect(replaceSmileyCodesWithImages(longCode)).toBe(longCode);
	});

	test("does not match named code with uppercase", () => {
		// Regex only matches lowercase + digits
		expect(replaceSmileyCodesWithImages(":SMILE:")).toBe(":SMILE:");
	});

	test("does not match named code with underscores", () => {
		expect(replaceSmileyCodesWithImages(":foo_bar:")).toBe(":foo_bar:");
	});

	// ── Mixed content ───────────────────────────────────────────────

	test("handles mixed HTML and multiple smiley code types", () => {
		const input = '<p>Hello {:2_135:} world :smile: and {:3_150:} end</p>';
		const result = replaceSmileyCodesWithImages(input);

		expect(result).toContain("coolmonkey/03.gif");
		expect(result).toContain("default/smile.gif");
		expect(result).toContain("comcom/2.gif");
		expect(result).toContain("<p>Hello");
		expect(result).toContain("end</p>");
	});

	test("handles content with both renderable and unrenderable codes", () => {
		const input = ":smile: {:soso_e100:} {:2_140:}";
		const result = replaceSmileyCodesWithImages(input);

		expect(result).toContain("default/smile.gif");
		expect(result).toContain("{:soso_e100:}"); // preserved
		expect(result).toContain("coolmonkey/08.gif");
	});

	test("handles all three new named codes in one string", () => {
		const input = "Check :cool: and :w00t: also :wink: here";
		const result = replaceSmileyCodesWithImages(input);

		expect(result).toContain("cool.gif");
		expect(result).toContain("w00t.gif");
		expect(result).toContain("wink.gif");
	});

	// ── Regex statefulness guard ────────────────────────────────────

	test("produces consistent results on repeated calls", () => {
		const input = ":smile: {:2_133:} :w00t:";
		const r1 = replaceSmileyCodesWithImages(input);
		const r2 = replaceSmileyCodesWithImages(input);
		expect(r1).toBe(r2);
	});

	// ── Comprehensive: all 32 named codes resolve to img ────────────

	test("every named smiley code in the mapping produces an <img>", () => {
		for (const name of NAMED_SMILEY_SET) {
			const input = `:${name}:`;
			const result = replaceSmileyCodesWithImages(input);
			expect(result).toContain("<img ");
			expect(result).toContain(`default/${name}`);
			expect(result).toContain('class="smiley"');
		}
	});
});
