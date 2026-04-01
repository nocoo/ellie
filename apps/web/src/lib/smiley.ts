// Smiley code → CDN image replacement (display-time only, no data mutation).
//
// Discuz migrations left raw smiley codes in post content (e.g. {:2_139:},
// {:3_154:}, :smile:, :w00t:, :ico29:). This module converts them to <img> tags
// pointing at the R2-hosted GIF files.
//
// Security: all outputs are built from a closed whitelist of filenames and
// a fixed CDN base URL — user-supplied text never reaches src/alt attributes
// without validation.

import { getSmileyUrl } from "./cdn";

// ---------------------------------------------------------------------------
// Named smiley codes → default/*.gif  (includes Discuz common smileys)
// ---------------------------------------------------------------------------

const NAMED_SMILEYS: Record<string, string> = {
	// Original 32 smileys
	smile: "smile.gif",
	biggrin: "biggrin.gif",
	cry: "cry.gif",
	sweat: "sweat.gif",
	huffy: "huffy.gif",
	curse: "curse.gif",
	shy: "shy.gif",
	lol: "lol.gif",
	funk: "funk.gif",
	loveliness: "loveliness.gif",
	handshake: "handshake.gif",
	victory: "victory.gif",
	time: "time.gif",
	kiss: "kiss.gif",
	hug: "hug.gif",
	titter: "titter.gif",
	call: "call.gif",
	dizzy: "dizzy.gif",
	shutup: "shutup.gif",
	sleepy: "sleepy.gif",
	mad: "mad.gif",
	tongue: "tongue.gif",
	sad: "sad.gif",
	shocked: "shocked.gif",
	cool: "cool.gif",
	w00t: "w00t.gif",
	wink: "wink.gif",
	angry: "angry.gif",
	crazy: "crazy.gif",
	dozingoff: "dozingoff.gif",
	laugh: "laugh.gif",
	rolleyes: "rolleyes.gif",
	// Additional Discuz common smileys
	unhappy: "unhappy.gif",
	bigsmile: "bigsmile.gif",
	// ico series (Discuz common set) — ico29 is confirmed on CDN
	ico29: "ico29.gif",
};

// Build Set for O(1) lookups
const NAMED_SMILEY_SET = new Set(Object.keys(NAMED_SMILEYS));

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

// :N: — numbered smileys in default directory (1-16 confirmed on CDN)
// Negative lookbehind avoids matching inside {:...:} patterns.
const RE_NUMBERED = /(?<!\{):(\d{1,2}):(?!\})/g;

// :name: — named codes (lowercase + digits, e.g. :w00t:, :smile:, :ico29:)
// Negative lookbehind avoids matching inside {:...:} patterns.
// Length capped at 20 to prevent ReDoS on adversarial input.
const RE_NAMED = /(?<!\{):([a-z][a-z0-9]{0,19}):(?!\})/g;

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
 * Build a smiley `<img>` tag. The `dir` and `file` params come from our
 * closed whitelist (never from user input). The `code` is the raw matched
 * text and is escaped before insertion into the `alt` attribute.
 */
function smileyImg(dir: string, file: string, code: string): string {
	const url = getSmileyUrl(dir, file);
	return `<img src="${url}" alt="${escapeAttr(code)}" class="smiley" />`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace smiley codes in HTML with `<img>` tags pointing to CDN-hosted GIFs.
 *
 * Handles:
 * - `{:2_NNN:}` → coolmonkey pack (IDs 133–148)
 * - `{:3_NNN:}` → comcom pack (IDs 149–172)
 * - `:N:` → default pack numbered smileys (1–16)
 * - `:name:` → default pack named codes (e.g. :smile:, :w00t:, :ico29:)
 *
 * Unrecognized codes ({:soso_eNNN:}, {:soso__LONG:}, unknown names) are left
 * as-is — no data is mutated, this is display-time only.
 */
export function replaceSmileyCodesWithImages(html: string): string {
	if (!html) return html;

	let result = html;

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

	// 4. Named :word: (includes :ico29:, :unhappy:, etc.)
	result = result.replace(RE_NAMED, (match, name) => {
		const file = NAMED_SMILEYS[name];
		return file ? smileyImg("default", file, match) : match;
	});

	return result;
}

// Export internals for testing
export {
	NAMED_SMILEY_SET,
	NAMED_SMILEYS,
	coolmonkeyFilename,
	comcomFilename,
	numberedFilename,
	escapeAttr,
};
