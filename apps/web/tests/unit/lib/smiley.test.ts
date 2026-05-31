import {
	DEFAULT_NAMED_SMILEY_NAMES,
	DEFAULT_NAMED_SMILEY_SET,
	SMILEY_PACKS,
	comcomFilename,
	coolmonkeyFilename,
	escapeAttr,
	namedSmileyFilename,
	numberedFilename,
	replaceSmileyCodesWithImages,
} from "@/lib/smiley";
import { describe, expect, test } from "vitest";

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
		expect(coolmonkeyFilename(Number.NaN)).toBeNull();
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
		expect(comcomFilename(Number.NaN)).toBeNull();
	});
});

// ── namedSmileyFilename — closed whitelist gate ───────────────────────
//
// D1 inventory (2026-05-08) drove the curation: items with non-zero hits
// in `posts.content` plus items already on the prior runtime whitelist.
// Names that have 0 hits AND were never previously rendered (icon1..icon9,
// some `*_smile` variants) are intentionally absent.

describe("namedSmileyFilename", () => {
	test("accepts every name in the curated whitelist", () => {
		expect(namedSmileyFilename("eh")).toBe("eh.gif");
		expect(namedSmileyFilename("smile")).toBe("smile.gif");
		expect(namedSmileyFilename("w00t")).toBe("w00t.gif");
		expect(namedSmileyFilename("smile_blush")).toBe("smile_blush.gif");
		expect(namedSmileyFilename("ico29")).toBe("ico29.gif");
		expect(namedSmileyFilename("angel_smile")).toBe("angel_smile.gif");
		expect(namedSmileyFilename("smile_8ball")).toBe("smile_8ball.gif");
	});

	test("accepts the longest whitelist entry (whatchutalkingabout_smile)", () => {
		expect(namedSmileyFilename("whatchutalkingabout_smile")).toBe("whatchutalkingabout_smile.gif");
	});

	test("rejects names not in the whitelist", () => {
		// Previously matched by the open-mapping prototype but never on the
		// curated list (no D1 hits, never in legacy whitelist).
		expect(namedSmileyFilename("foo_bar1")).toBeNull();
		expect(namedSmileyFilename("someemoji")).toBeNull();
		expect(namedSmileyFilename("icon1")).toBeNull();
		expect(namedSmileyFilename("icon9")).toBeNull();
		expect(namedSmileyFilename("present_smile")).toBeNull();
	});

	test("rejects names with uppercase, hyphens, dots, or slashes", () => {
		expect(namedSmileyFilename("SMILE")).toBeNull();
		expect(namedSmileyFilename("foo-bar")).toBeNull();
		expect(namedSmileyFilename("foo.bar")).toBeNull();
		expect(namedSmileyFilename("../x")).toBeNull();
		expect(namedSmileyFilename("foo/bar")).toBeNull();
	});

	test("rejects empty input", () => {
		expect(namedSmileyFilename("")).toBeNull();
	});
});

// ── numberedFilename ─────────────────────────────────────────────────

describe("numberedFilename", () => {
	test("maps 1 → 1.gif", () => {
		expect(numberedFilename(1)).toBe("1.gif");
	});

	test("maps 16 → 16.gif", () => {
		expect(numberedFilename(16)).toBe("16.gif");
	});

	test("maps 8 → 8.gif", () => {
		expect(numberedFilename(8)).toBe("8.gif");
	});

	test("returns null for out-of-range IDs", () => {
		expect(numberedFilename(0)).toBeNull();
		expect(numberedFilename(17)).toBeNull();
		expect(numberedFilename(-1)).toBeNull();
	});

	test("returns null for non-integer IDs", () => {
		expect(numberedFilename(1.5)).toBeNull();
		expect(numberedFilename(Number.NaN)).toBeNull();
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

	// ── Named codes — known historical names ───────────────────────

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

	test("replaces :ico29: with default/ico29.gif", () => {
		const result = replaceSmileyCodesWithImages(":ico29:");
		expect(result).toBe(`<img src="${CDN}/default/ico29.gif" alt=":ico29:" class="smiley" />`);
	});

	test("replaces :smile_blush: (underscore variant) with default/smile_blush.gif", () => {
		const result = replaceSmileyCodesWithImages(":smile_blush:");
		expect(result).toBe(
			`<img src="${CDN}/default/smile_blush.gif" alt=":smile_blush:" class="smiley" />`,
		);
	});

	test("replaces :tounge: (common misspelling) with default/tounge.gif", () => {
		const result = replaceSmileyCodesWithImages(":tounge:");
		expect(result).toBe(`<img src="${CDN}/default/tounge.gif" alt=":tounge:" class="smiley" />`);
	});

	test("replaces :eh: with default/eh.gif (added based on D1 hits)", () => {
		const result = replaceSmileyCodesWithImages(":eh:");
		expect(result).toBe(`<img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" />`);
	});

	// Historical Discuz form `:name.gif:` (5,398 D1 hits for :angry.gif:, never
	// tokenized to :angry:). The optional .gif suffix is stripped before the
	// whitelist gate, so the alt attribute preserves the original token.

	test("replaces :angry.gif: (legacy Discuz form) with default/angry.gif img", () => {
		const result = replaceSmileyCodesWithImages(":angry.gif:");
		expect(result).toBe(`<img src="${CDN}/default/angry.gif" alt=":angry.gif:" class="smiley" />`);
	});

	test("renders thread 725604 fragment with :angry.gif: mixed in", () => {
		// Reduced from D1 thread_id=725604, posted 2010-04-03 23:01:32.
		const input = ":ico29: :w00t: :angry.gif: :crazy: :eh:";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`<img src="${CDN}/default/ico29.gif" alt=":ico29:" class="smiley" /> ` +
				`<img src="${CDN}/default/w00t.gif" alt=":w00t:" class="smiley" /> ` +
				`<img src="${CDN}/default/angry.gif" alt=":angry.gif:" class="smiley" /> ` +
				`<img src="${CDN}/default/crazy.gif" alt=":crazy:" class="smiley" /> ` +
				`<img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" />`,
		);
	});

	test("leaves :angry_smile.gif: unchanged (.gif must not bypass whitelist)", () => {
		// `angry_smile` is not on the curated whitelist (0 D1 hits, never on
		// the prior runtime whitelist). The .gif suffix must not smuggle it in.
		expect(replaceSmileyCodesWithImages(":angry_smile.gif:")).toBe(":angry_smile.gif:");
	});

	test("leaves :foo.gif: unchanged (whitelist still gates names)", () => {
		expect(replaceSmileyCodesWithImages(":foo.gif:")).toBe(":foo.gif:");
	});

	test("replaces the longest whitelist entry :whatchutalkingabout_smile:", () => {
		const result = replaceSmileyCodesWithImages(":whatchutalkingabout_smile:");
		expect(result).toBe(
			`<img src="${CDN}/default/whatchutalkingabout_smile.gif" alt=":whatchutalkingabout_smile:" class="smiley" />`,
		);
	});

	test("renders :eh: alongside other named codes in mixed content", () => {
		const result = replaceSmileyCodesWithImages("hi :eh: and :smile: too");
		expect(result).toBe(
			`hi <img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" /> and ` +
				`<img src="${CDN}/default/smile.gif" alt=":smile:" class="smiley" /> too`,
		);
	});

	test("replaces multiple distinct named codes", () => {
		const result = replaceSmileyCodesWithImages(":smile::victory:");
		expect(result).toContain("default/smile.gif");
		expect(result).toContain("default/victory.gif");
	});

	// ── Whitelist gate: out-of-list names stay raw ──────────────────

	test("leaves unknown :name: tokens unchanged (closed whitelist)", () => {
		// Match the regex shape but are not on the whitelist → pass-through.
		expect(replaceSmileyCodesWithImages(":foo_bar1:")).toBe(":foo_bar1:");
		expect(replaceSmileyCodesWithImages(":someemoji:")).toBe(":someemoji:");
		expect(replaceSmileyCodesWithImages(":icon1:")).toBe(":icon1:");
	});

	// ── Safety boundaries that must NOT render ──────────────────────

	test("does not match named code with uppercase", () => {
		expect(replaceSmileyCodesWithImages(":SMILE:")).toBe(":SMILE:");
		expect(replaceSmileyCodesWithImages(":Eh:")).toBe(":Eh:");
	});

	test("does not match name starting with a digit or underscore", () => {
		expect(replaceSmileyCodesWithImages(":1abc:")).toBe(":1abc:");
		expect(replaceSmileyCodesWithImages(":_foo:")).toBe(":_foo:");
	});

	test("does not match path-traversal-looking tokens", () => {
		// Dots, slashes, and hyphens are outside the regex char class — token
		// stays as raw text rather than producing default/../x.gif.
		expect(replaceSmileyCodesWithImages(":../x:")).toBe(":../x:");
		expect(replaceSmileyCodesWithImages(":foo-bar:")).toBe(":foo-bar:");
		expect(replaceSmileyCodesWithImages(":foo.bar:")).toBe(":foo.bar:");
		expect(replaceSmileyCodesWithImages(":foo/bar:")).toBe(":foo/bar:");
	});

	test("does not process named codes longer than the regex cap (ReDoS guard)", () => {
		// Regex caps the captured name at 30 chars total. A 31-char name
		// must NOT match — even if it would otherwise look like a smiley.
		const longName = "a".repeat(31);
		const longCode = `:${longName}:`;
		expect(replaceSmileyCodesWithImages(longCode)).toBe(longCode);
	});

	test("does not match bare single-letter capital codes like :A:", () => {
		expect(replaceSmileyCodesWithImages(":A:")).toBe(":A:");
	});

	// ── Numbered :N: codes ─────────────────────────────────────────────

	test("replaces :1: with default/1.gif", () => {
		const result = replaceSmileyCodesWithImages(":1:");
		expect(result).toBe(`<img src="${CDN}/default/1.gif" alt=":1:" class="smiley" />`);
	});

	test("replaces :16: with default/16.gif", () => {
		const result = replaceSmileyCodesWithImages(":16:");
		expect(result).toBe(`<img src="${CDN}/default/16.gif" alt=":16:" class="smiley" />`);
	});

	test("leaves :17: unchanged (out of range)", () => {
		expect(replaceSmileyCodesWithImages(":17:")).toBe(":17:");
	});

	test("leaves :0: unchanged (out of range)", () => {
		expect(replaceSmileyCodesWithImages(":0:")).toBe(":0:");
	});

	test("leaves :200: unchanged (regex caps numeric at 2 digits; D1 shows IPv6 use)", () => {
		expect(replaceSmileyCodesWithImages("fe80::200:e8ff")).toBe("fe80::200:e8ff");
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
		expect(result).toBe(`<img src="${CDN}/coolmonkey/16.gif" alt="{:2_148:}" class="smiley" />`);
	});

	test("leaves out-of-range coolmonkey IDs unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:2_132:}")).toBe("{:2_132:}");
		expect(replaceSmileyCodesWithImages("{:2_200:}")).toBe("{:2_200:}");
	});

	// ── Comcom {:3_NNN:} ────────────────────────────────────────────

	test("replaces {:3_149:} with comcom/1.gif", () => {
		const result = replaceSmileyCodesWithImages("{:3_149:}");
		expect(result).toBe(`<img src="${CDN}/comcom/1.gif" alt="{:3_149:}" class="smiley" />`);
	});

	test("replaces {:3_172:} with comcom/24.gif", () => {
		const result = replaceSmileyCodesWithImages("{:3_172:}");
		expect(result).toBe(`<img src="${CDN}/comcom/24.gif" alt="{:3_172:}" class="smiley" />`);
	});

	test("leaves out-of-range comcom IDs unchanged", () => {
		expect(replaceSmileyCodesWithImages("{:3_148:}")).toBe("{:3_148:}");
		expect(replaceSmileyCodesWithImages("{:3_173:}")).toBe("{:3_173:}");
	});

	// ── Unhandled codes (pass-through) ──────────────────────────────

	test("leaves {:1_NNN:} default-pack numeric codes unchanged (out-of-scope)", () => {
		// Tracked as a separate follow-up — needs the legacy cache_smiley map.
		expect(replaceSmileyCodesWithImages("{:1_200:}")).toBe("{:1_200:}");
		expect(replaceSmileyCodesWithImages("{:1_220:}")).toBe("{:1_220:}");
	});

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

	test("does not replace colons around pure numbers outside valid range", () => {
		expect(replaceSmileyCodesWithImages(":123:")).toBe(":123:");
		expect(replaceSmileyCodesWithImages(":99:")).toBe(":99:");
	});

	// ── Injection prevention ────────────────────────────────────────

	test("escapes HTML in alt attribute for crafted coolmonkey code", () => {
		const result = replaceSmileyCodesWithImages("{:2_133:}");
		expect(result).toContain('alt="{:2_133:}"');
		expect(result).not.toContain("<script>");
	});

	// ── Mixed content ───────────────────────────────────────────────

	test("handles mixed HTML and multiple smiley code types", () => {
		const input = "<p>Hello {:2_135:} world :smile: and {:3_150:} end</p>";
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

	// ── Regex statefulness guard ────────────────────────────────────

	test("produces consistent results on repeated calls", () => {
		const input = ":smile: {:2_133:} :w00t:";
		const r1 = replaceSmileyCodesWithImages(input);
		const r2 = replaceSmileyCodesWithImages(input);
		expect(r1).toBe(r2);
	});

	// ── HTML-aware: tokens inside attributes / tag bodies are NOT replaced ─

	test("does not replace :word: inside an anchor's href or title", () => {
		const input = '<a href="/search?q=:foo:" title=":bar:">:eh:</a>';
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`<a href="/search?q=:foo:" title=":bar:"><img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" /></a>`,
		);
		// Belt-and-braces: nothing should have leaked an <img> into the attribute strings
		expect(result).toContain('href="/search?q=:foo:"');
		expect(result).toContain('title=":bar:"');
	});

	test("does not touch attributes on a self-closing img tag", () => {
		const input = '<img alt=":eh:" src="/x/:foo:.png" />';
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(input);
	});

	test("does not replace tokens in numbered/coolmonkey IDs hidden inside attributes", () => {
		const input = '<a href="/p?q={:2_133:}&t={:3_149:}">hi :smile:</a>';
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toContain('href="/p?q={:2_133:}&t={:3_149:}"');
		expect(result).toContain(`<img src="${CDN}/default/smile.gif"`);
	});

	test("does not replace tokens inside <code> blocks", () => {
		const input = "<p>regular :smile:</p><code>literal :smile: stays</code>";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toContain(
			`<p>regular <img src="${CDN}/default/smile.gif" alt=":smile:" class="smiley" /></p>`,
		);
		expect(result).toContain("<code>literal :smile: stays</code>");
	});

	test("does not replace tokens inside <pre> blocks", () => {
		const input = "<pre>:eh: {:2_133:} :1:</pre><p>:eh:</p>";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toContain("<pre>:eh: {:2_133:} :1:</pre>");
		expect(result).toContain(`<p><img src="${CDN}/default/eh.gif"`);
	});

	test("does not replace tokens inside <script> or <style>", () => {
		const input = "<script>var s = ':smile:';</script><style>.x{content:':eh:';}</style>";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(input);
	});

	test("does not replace tokens inside HTML comments", () => {
		const input = "<!-- :eh: stays --> hi :eh:";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`<!-- :eh: stays --> hi <img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" />`,
		);
	});

	test("handles consecutive tags and text correctly", () => {
		const input = "<b>:smile:</b><i>:cry:</i>plain :eh:";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`<b><img src="${CDN}/default/smile.gif" alt=":smile:" class="smiley" /></b>` +
				`<i><img src="${CDN}/default/cry.gif" alt=":cry:" class="smiley" /></i>` +
				`plain <img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" />`,
		);
	});

	test("handles self-closing void tags between text", () => {
		const input = "before :eh:<br/>after :smile:";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`before <img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" /><br/>` +
				`after <img src="${CDN}/default/smile.gif" alt=":smile:" class="smiley" />`,
		);
	});

	test("nested code inside paragraph still skipped", () => {
		const input = "<p>before <code>:eh:</code> after :eh:</p>";
		const result = replaceSmileyCodesWithImages(input);
		expect(result).toBe(
			`<p>before <code>:eh:</code> after <img src="${CDN}/default/eh.gif" alt=":eh:" class="smiley" /></p>`,
		);
	});
});

// ── Picker / SMILEY_PACKS data sanity ───────────────────────────────────
//
// The picker emits the same legacy tokens that the renderer consumes, so a
// drift between the two would mean the picker offers smileys the renderer
// silently drops (or vice versa). These tests pin both sides to the same
// `DEFAULT_NAMED_SMILEY_NAMES` whitelist so they cannot diverge.

describe("SMILEY_PACKS picker data", () => {
	test("DEFAULT_NAMED_SMILEY_SET is derived from DEFAULT_NAMED_SMILEY_NAMES", () => {
		expect(DEFAULT_NAMED_SMILEY_SET.size).toBe(DEFAULT_NAMED_SMILEY_NAMES.length);
		for (const name of DEFAULT_NAMED_SMILEY_NAMES) {
			expect(DEFAULT_NAMED_SMILEY_SET.has(name)).toBe(true);
		}
	});

	test("DEFAULT_NAMED_SMILEY_NAMES has no duplicates", () => {
		expect(new Set(DEFAULT_NAMED_SMILEY_NAMES).size).toBe(DEFAULT_NAMED_SMILEY_NAMES.length);
	});

	test("DEFAULT_NAMED_SMILEY_NAMES uses only safe filename characters", () => {
		for (const name of DEFAULT_NAMED_SMILEY_NAMES) {
			expect(name).toMatch(/^[a-z][a-z0-9_]{0,29}$/);
		}
	});

	test("default pack contains numbered 1-16 followed by every whitelist name", () => {
		const def = SMILEY_PACKS.default;
		// Numbered 1-16 lead the picker grid.
		for (let i = 1; i <= 16; i++) {
			const item = def.find((s) => s.code === `:${i}:`);
			expect(item).toBeDefined();
			expect(item?.file).toBe(`${i}.gif`);
		}
		// Every whitelist name is also exposed via the picker.
		for (const name of DEFAULT_NAMED_SMILEY_NAMES) {
			const item = def.find((s) => s.code === `:${name}:`);
			expect(item).toBeDefined();
			expect(item?.file).toBe(`${name}.gif`);
		}
		expect(def.length).toBe(16 + DEFAULT_NAMED_SMILEY_NAMES.length);
	});

	test("every default-pack picker token round-trips through the renderer", () => {
		for (const item of SMILEY_PACKS.default) {
			const html = replaceSmileyCodesWithImages(item.code);
			expect(html).toContain(`/default/${item.file}`);
			expect(html).toContain(`alt="${item.code}"`);
		}
	});

	test("coolmonkey pack covers IDs 133-148 mapped to 01.gif-16.gif", () => {
		const cm = SMILEY_PACKS.coolmonkey;
		expect(cm.length).toBe(16);
		expect(cm[0]).toEqual({ code: "{:2_133:}", file: "01.gif" });
		expect(cm[15]).toEqual({ code: "{:2_148:}", file: "16.gif" });
	});

	test("comcom pack covers IDs 149-172 mapped to 1.gif-24.gif", () => {
		const cc = SMILEY_PACKS.comcom;
		expect(cc.length).toBe(24);
		expect(cc[0]).toEqual({ code: "{:3_149:}", file: "1.gif" });
		expect(cc[23]).toEqual({ code: "{:3_172:}", file: "24.gif" });
	});

	test("every coolmonkey/comcom picker token round-trips through the renderer", () => {
		for (const item of SMILEY_PACKS.coolmonkey) {
			const html = replaceSmileyCodesWithImages(item.code);
			expect(html).toContain(`/coolmonkey/${item.file}`);
		}
		for (const item of SMILEY_PACKS.comcom) {
			const html = replaceSmileyCodesWithImages(item.code);
			expect(html).toContain(`/comcom/${item.file}`);
		}
	});

	test("0-hit / non-legacy items are NOT in the whitelist", () => {
		// D1 inventory (2026-05-08) showed these have zero usage and were
		// never on the prior runtime whitelist. They must stay out so the
		// picker never offers them.
		const excluded = [
			"icon1",
			"icon2",
			"icon3",
			"icon4",
			"icon5",
			"icon6",
			"icon7",
			"icon8",
			"icon9",
			"angry_smile",
			"omg_smile",
			"present_smile",
			"regular_smile",
			"sad_smile",
			"smile_shock",
			"teeth_smile",
			"tounge_smile",
		];
		for (const name of excluded) {
			expect(DEFAULT_NAMED_SMILEY_SET.has(name)).toBe(false);
		}
	});
});
