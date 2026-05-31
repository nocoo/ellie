// Smiley code → CDN image replacement (display-time only, no data mutation).
//
// Discuz migrations left raw smiley codes in post content (e.g. {:2_139:},
// {:3_154:}, :smile:, :w00t:, :eh:). This module converts them to <img> tags
// pointing at the R2-hosted GIF files. The same SMILEY_PACKS data also
// drives the editor's smiley picker, so old content and new posts share one
// canonical token format and one whitelist.
//
// Security: outputs are built from a closed whitelist (default named) plus
// numeric range checks (default numbered, coolmonkey, comcom) and a fixed
// CDN base URL — user-supplied text never reaches src/alt attributes
// without validation, and the alt attribute is HTML-entity escaped.
//
// Scope (D1 inventory, 2026-05-08): out-of-scope tokens explicitly NOT
// rendered here (logged for follow-up tickets, not silently swallowed):
//   - {:1_NNN:} default-pack numeric tokens (need legacy cache_smiley map)
//   - {:soso_eNNN:} (CDN missing soso/ directory)
//   - {:3_NN:} for NN ∉ [149..172] (no historical hits)
//   - grapeman tokens (format unknown, no historical hits)

import { getSmileyUrl } from "./cdn";

// ---------------------------------------------------------------------------
// Default-pack named smileys (closed whitelist).
//
// Source of truth: the file inventory zheng-li produced from the R2 bucket
// on 2026-05-08. We list the *names* once (DEFAULT_NAMED_SMILEY_NAMES) and
// derive everything else from it:
//   - DEFAULT_NAMED_SMILEY_SET — O(1) gate for the renderer
//   - SMILEY_PACKS.default named entries — picker grid
// This way the picker can never offer a code the renderer would silently
// drop, and vice versa.
//
// `200.gif` is intentionally NOT in this list. D1 evidence: the bare token
// `:200:` only appears inside IPv6 literals (`fe80::200:e8ff:...`); the
// real Discuz token for 200.gif is `{:1_200:}`, which belongs to a wider
// `{:1_NNN:}` family that needs the legacy cache_smiley dictionary to map
// other IDs and is therefore tracked as a separate follow-up.
//
// Names use only `[a-z][a-z0-9_]*` (matched by RE_NAMED), so they are safe
// to interpolate into a path segment.
// ---------------------------------------------------------------------------

// Curation rule (zheng-li + SD-Reviewer-A, 2026-05-08): include every name
// with non-zero hits in the D1 inventory, plus every name that was already
// in the prior runtime whitelist (so we don't regress on legacy posts even
// when current hits are zero). Names that have 0 hits AND were never in the
// prior whitelist (icon1..icon9, *_smile variants the CDN stores but nobody
// posts) stay out of the picker and renderer.
const DEFAULT_NAMED_SMILEY_NAMES = [
	"angel_smile",
	"angry",
	"beer_smile",
	"biggrin",
	"bigsmile",
	"bowwow_smile",
	"broken_heart_smile",
	"cake_smile",
	"call",
	"camera_smile",
	"clock_smile",
	"coffee_smile",
	"confused_smile",
	"cool",
	"crazy",
	"cry",
	"curse",
	"devil_smile",
	"dizzy",
	"dozingoff",
	"dude_hug_smile",
	"eh",
	"embaressed_smile",
	"envelope_smile",
	"fight_smile",
	"film_smile",
	"food_smile",
	"funk",
	"handshake",
	"heart_smile",
	"huffy",
	"hug",
	"ico29",
	"kiss",
	"kiss_smile",
	"kittykay_smile",
	"laugh",
	"lightbulb_smile",
	"lol",
	"loveliness",
	"mad",
	"moon_smile",
	"music_smile",
	"musical_note_smile",
	"omg",
	"phone_smile",
	"rolleyes",
	"rose_smile",
	"sad",
	"shades_smile",
	"shocked",
	"shutup",
	"shy",
	"sleepy",
	"sleepy_smile",
	"smile",
	"smile_8ball",
	"smile_angry",
	"smile_approve",
	"smile_big",
	"smile_blackeye",
	"smile_blush",
	"smile_clown",
	"smile_cool",
	"smile_cry",
	"smile_dead",
	"smile_disapprove",
	"smile_evil",
	"smile_kisses",
	"smile_question",
	"smile_sad",
	"smile_shy",
	"smile_sleepy",
	"smile_tongue",
	"smile_wink",
	"star_smile",
	"stupid_smile",
	"sweat",
	"thumbs_down_smile",
	"thumbs_up_smile",
	"time",
	"titter",
	"tongue",
	"tounge",
	"unhappy",
	"victory",
	"w00t",
	"whatchutalkingabout_smile",
	"wilted_rose_smile",
	"wink",
	"wink_smile",
] as const;

const DEFAULT_NAMED_SMILEY_SET: ReadonlySet<string> = new Set(DEFAULT_NAMED_SMILEY_NAMES);

/**
 * If `name` is in the default-pack whitelist, return its filename. Otherwise
 * return null so the caller can leave the original token in place.
 */
function namedSmileyFilename(name: string): string | null {
	return DEFAULT_NAMED_SMILEY_SET.has(name) ? `${name}.gif` : null;
}

// ---------------------------------------------------------------------------
// Coolmonkey: {:2_133:} → coolmonkey/01.gif … {:2_148:} → coolmonkey/16.gif
// ---------------------------------------------------------------------------

const COOLMONKEY_ID_START = 133;
const COOLMONKEY_ID_END = 148;

function coolmonkeyFilename(id: number): string | null {
	if (!Number.isInteger(id) || id < COOLMONKEY_ID_START || id > COOLMONKEY_ID_END) return null;
	const index = id - COOLMONKEY_ID_START + 1;
	return `${index.toString().padStart(2, "0")}.gif`;
}

// ---------------------------------------------------------------------------
// Comcom: {:3_149:} → comcom/1.gif … {:3_172:} → comcom/24.gif
//
// Note: the R2 bucket has 30 comcom GIFs (1–30) but historical posts only
// reference IDs 149–172 (mapping to 1–24). We keep the range narrow until
// there is evidence of {:3_173:}+ tokens; the extra files stay unused.
// ---------------------------------------------------------------------------

const COMCOM_ID_START = 149;
const COMCOM_ID_END = 172;

function comcomFilename(id: number): string | null {
	if (!Number.isInteger(id) || id < COMCOM_ID_START || id > COMCOM_ID_END) return null;
	const index = id - COMCOM_ID_START + 1;
	return `${index}.gif`;
}

// ---------------------------------------------------------------------------
// Regex patterns (order matters — specific patterns before general)
// ---------------------------------------------------------------------------

// {:2_NNN:} — coolmonkey (1-4 digit IDs only to prevent ReDoS)
const RE_COOLMONKEY = /\{:2_(\d{1,4}):\}/g;

// {:3_NNN:} — comcom (1-4 digit IDs only)
const RE_COMCOM = /\{:3_(\d{1,4}):\}/g;

// :N: — numbered smileys in default directory (1-16 confirmed on CDN).
// Negative lookbehind avoids matching inside {:...:} patterns. The 2-digit
// cap is deliberate: the only longer numeric default name (`200.gif`) is
// addressed via `{:1_200:}`, not bare `:200:` (which D1 shows is IPv6).
const RE_NUMBERED = /(?<!\{):(\d{1,2}):(?!\})/g;

// :name: — named codes (lowercase + digits + underscores).
// Length cap 30 chars total covers the longest known whitelist entry
// `whatchutalkingabout_smile` (25 chars) with headroom; still bounded to
// keep the regex linear-time. Closed whitelist below the regex is the real
// gate — the regex is just a cheap pre-filter.
//
// The optional `.gif` suffix matches the historical Discuz form
// `:angry.gif:` (5,398 D1 hits — never tokenized to `:angry:`). The
// suffix is captured separately and stripped before the whitelist
// lookup, so an extension cannot smuggle in a non-whitelisted name.
const RE_NAMED = /(?<!\{):([a-z][a-z0-9_]{0,29})(?:\.gif)?:(?!\})/g;

// ---------------------------------------------------------------------------
// Numbered smiley validation (1.gif to 16.gif in default directory)
// ---------------------------------------------------------------------------

const NUMBERED_SMILEY_MIN = 1;
const NUMBERED_SMILEY_MAX = 16;

function numberedFilename(num: number): string | null {
	if (!Number.isInteger(num) || num < NUMBERED_SMILEY_MIN || num > NUMBERED_SMILEY_MAX) {
		return null;
	}
	return `${num}.gif`;
}

// ---------------------------------------------------------------------------
// Injection-safe HTML builder
// ---------------------------------------------------------------------------

/** Escape HTML special chars in alt text to prevent attribute injection. */
function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Build a smiley `<img>` tag. The `dir` is hard-coded by the caller; `file`
 * comes either from a numeric range check (numbered/coolmonkey/comcom) or
 * from a closed-whitelist name lookup (`namedSmileyFilename`). The `code`
 * is the raw matched text and is HTML-escaped before insertion into `alt`.
 */
function smileyImg(dir: string, file: string, code: string): string {
	const url = getSmileyUrl(dir, file);
	return `<img src="${url}" alt="${escapeAttr(code)}" class="smiley" />`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the four token replacements on a plain-text segment (no HTML markup).
 * Order matters — specific patterns before general so e.g. `{:2_133:}` is
 * consumed before the inner `:2_133:` window can be re-examined.
 */
function applyTokenReplacements(text: string): string {
	let result = text;

	// 1. Coolmonkey {:2_NNN:}
	result = result.replace(RE_COOLMONKEY, (match, idStr) => {
		const file = coolmonkeyFilename(Number(idStr));
		return file ? smileyImg("coolmonkey", file, match) : match;
	});

	// 2. Comcom {:3_NNN:}
	result = result.replace(RE_COMCOM, (match, idStr) => {
		const file = comcomFilename(Number(idStr));
		return file ? smileyImg("comcom", file, match) : match;
	});

	// 3. Numbered :N: (1-16)
	result = result.replace(RE_NUMBERED, (match, numStr) => {
		const file = numberedFilename(Number(numStr));
		return file ? smileyImg("default", file, match) : match;
	});

	// 4. Named :word: — closed whitelist gate via namedSmileyFilename. Names
	//    not in DEFAULT_NAMED_SMILEY_SET are left as raw text.
	result = result.replace(RE_NAMED, (match, name) => {
		const file = namedSmileyFilename(name);
		return file ? smileyImg("default", file, match) : match;
	});

	return result;
}

// Tags whose textual content is treated as opaque (raw text or programmatic)
// and must be passed through verbatim. `<script>` and `<style>` are sanitized
// out upstream, but skipping them defensively costs nothing and keeps this
// module robust if the pipeline order ever changes.
const RAW_TEXT_TAGS = new Set(["script", "style", "code", "pre", "textarea", "title"]);

const RE_TAG_NAME = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/;

/** Locate the end (exclusive) of a markup construct that opens at index `i`. */
function findMarkupEnd(html: string, i: number): number {
	if (html.startsWith("<!--", i)) {
		const close = html.indexOf("-->", i + 4);
		return close === -1 ? html.length : close + 3;
	}
	// <!DOCTYPE …>, <![CDATA[…]]>, processing instructions <?…?>, regular tags.
	const close = html.indexOf(">", i + 1);
	return close === -1 ? html.length : close + 1;
}

/**
 * Update raw-text-region state given a tag we just emitted. Returns the
 * (possibly new) raw-text tag name, or null when not in a raw-text region.
 */
function nextRawState(rawTextTag: string | null, tagText: string): string | null {
	const m = RE_TAG_NAME.exec(tagText);
	if (!m) return rawTextTag;
	const tagName = m[1].toLowerCase();
	const isClose = tagText.startsWith("</");

	if (rawTextTag) {
		return isClose && tagName === rawTextTag ? null : rawTextTag;
	}
	if (isClose || tagText.endsWith("/>")) return null;
	return RAW_TEXT_TAGS.has(tagName) ? tagName : null;
}

/**
 * Walk an HTML string, applying smiley token replacement only to text that
 * sits BETWEEN tags. Tag bodies (`<...>`), HTML comments (`<!--...-->`),
 * CDATA-ish (`<![...]>`), and the contents of raw-text tags
 * (`<code>`, `<pre>`, `<script>`, `<style>`, `<textarea>`, `<title>`) are
 * passed through unchanged.
 *
 * This is deliberately a small character-level scanner rather than a full
 * HTML parser: post HTML has already been DOMPurify-sanitized upstream, so
 * we can trust well-formedness for the constructs we care about. The goal
 * is just to avoid corrupting tag/attribute syntax — if a malformed input
 * sneaks through (e.g. unclosed `<`), we fall back to treating the rest as
 * tag content (no token replacement), which is the safe direction.
 */
function walkHtmlAndReplace(html: string): string {
	const len = html.length;
	let out = "";
	let i = 0;
	let textStart = 0;
	let rawTextTag: string | null = null;

	const flushTextUpTo = (end: number): void => {
		if (end <= textStart) return;
		const segment = html.slice(textStart, end);
		out += rawTextTag ? segment : applyTokenReplacements(segment);
	};

	while (i < len) {
		if (html[i] !== "<") {
			i++;
			continue;
		}

		// `<` not followed by a name and not a markup-decl/comment/PI: treat
		// as literal text and keep scanning. (Sanitized HTML shouldn't hit
		// this, but be defensive.)
		const isMarkup =
			html.startsWith("<!", i) || html.startsWith("<?", i) || RE_TAG_NAME.test(html.slice(i));
		if (!isMarkup) {
			i++;
			continue;
		}

		flushTextUpTo(i);
		const end = findMarkupEnd(html, i);
		const tagText = html.slice(i, end);
		out += tagText;
		rawTextTag = nextRawState(rawTextTag, tagText);
		i = end;
		textStart = i;
	}

	flushTextUpTo(len);
	return out;
}

/**
 * Replace smiley codes in HTML with `<img>` tags pointing to CDN-hosted GIFs.
 *
 * Handles:
 * - `{:2_NNN:}` → coolmonkey pack (IDs 133–148)
 * - `{:3_NNN:}` → comcom pack (IDs 149–172)
 * - `:N:` → default pack numbered smileys (1–16)
 * - `:name:` → default pack named codes (closed whitelist; see
 *             DEFAULT_NAMED_SMILEY_NAMES)
 *
 * **Scope** (zheng-li / SD-Reviewer-A, 2026-05-08): replacement only runs on
 * text that sits between HTML tags. Tag bodies, attribute values, comments,
 * and the contents of raw-text containers (`<code>`, `<pre>`, `<script>`,
 * `<style>`, `<textarea>`, `<title>`) are left untouched, so legacy tokens
 * inside `href`, `title`, `alt`, etc. are not corrupted.
 *
 * Unrecognized codes (out-of-scope `{:1_*:}` / `{:soso_*:}` / unknown names)
 * are left as-is — no data is mutated, this is display-time only.
 */
export function replaceSmileyCodesWithImages(html: string): string {
	if (!html) return html;
	return walkHtmlAndReplace(html);
}

// Export internals for testing
export {
	DEFAULT_NAMED_SMILEY_NAMES,
	DEFAULT_NAMED_SMILEY_SET,
	namedSmileyFilename,
	coolmonkeyFilename,
	comcomFilename,
	numberedFilename,
	escapeAttr,
};

// ---------------------------------------------------------------------------
// Smiley pack data for UI display (SmileyPanel, UnifiedEmojiPicker).
//
// Driven by the same DEFAULT_NAMED_SMILEY_NAMES whitelist + range constants
// that the renderer uses, so picker-emitted tokens always round-trip through
// `replaceSmileyCodesWithImages`.
// ---------------------------------------------------------------------------

export interface SmileyItem {
	code: string;
	file: string;
}

export const SMILEY_PACKS: Record<string, SmileyItem[]> = {
	default: [
		// Numbered 1-16 first so the picker leads with the iconic faces
		...Array.from({ length: 16 }, (_, i) => ({
			code: `:${i + 1}:`,
			file: `${i + 1}.gif`,
		})),
		// Then the named whitelist, in source order
		...DEFAULT_NAMED_SMILEY_NAMES.map((name) => ({
			code: `:${name}:`,
			file: `${name}.gif`,
		})),
	],
	coolmonkey: Array.from({ length: 16 }, (_, i) => ({
		code: `{:2_${COOLMONKEY_ID_START + i}:}`,
		file: `${String(i + 1).padStart(2, "0")}.gif`,
	})),
	comcom: Array.from({ length: 24 }, (_, i) => ({
		code: `{:3_${COMCOM_ID_START + i}:}`,
		file: `${i + 1}.gif`,
	})),
};

export function getSmileyImageUrl(pack: string, file: string): string {
	return getSmileyUrl(pack, file);
}
