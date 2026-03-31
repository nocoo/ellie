// Smiley code → CDN image replacement (display-time only, no data mutation).
//
// Discuz migrations left raw smiley codes in post content (e.g. {:2_139:},
// {:3_154:}, :smile:). This module converts them to <img> tags pointing at
// the R2-hosted GIF files.

import { getSmileyUrl } from "./cdn";

// ---------------------------------------------------------------------------
// Named smiley codes → default/*.gif  (24 confirmed)
// ---------------------------------------------------------------------------

const NAMED_SMILEYS: Record<string, string> = {
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
};

// Build Set for O(1) lookups
const NAMED_SMILEY_SET = new Set(Object.keys(NAMED_SMILEYS));

// ---------------------------------------------------------------------------
// Coolmonkey: {:2_133:} → coolmonkey/01.gif … {:2_148:} → coolmonkey/16.gif
// ---------------------------------------------------------------------------

const COOLMONKEY_ID_START = 133;
const COOLMONKEY_ID_END = 148;

function coolmonkeyFilename(id: number): string | null {
	if (id < COOLMONKEY_ID_START || id > COOLMONKEY_ID_END) return null;
	const index = id - COOLMONKEY_ID_START + 1;
	return `${index.toString().padStart(2, "0")}.gif`;
}

// ---------------------------------------------------------------------------
// Comcom: {:3_149:} → comcom/1.gif … {:3_172:} → comcom/24.gif
// ---------------------------------------------------------------------------

const COMCOM_ID_START = 149;
const COMCOM_ID_END = 172;

function comcomFilename(id: number): string | null {
	if (id < COMCOM_ID_START || id > COMCOM_ID_END) return null;
	const index = id - COMCOM_ID_START + 1;
	return `${index}.gif`;
}

// ---------------------------------------------------------------------------
// Regex patterns (order matters — specific patterns before general)
// ---------------------------------------------------------------------------

// {:2_NNN:} — coolmonkey
const RE_COOLMONKEY = /\{:2_(\d+):\}/g;

// {:3_NNN:} — comcom
const RE_COMCOM = /\{:3_(\d+):\}/g;

// :name: — named codes (only word chars between colons, not inside { })
// Negative lookbehind to avoid matching inside {:...:} patterns.
// Matches standalone :word: but not inside already-processed patterns.
const RE_NAMED = /(?<!\{):([a-z]+):(?!\})/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function smileyImg(dir: string, file: string, code: string): string {
	const url = getSmileyUrl(dir, file);
	return `<img src="${url}" alt="${code}" class="smiley" />`;
}

/**
 * Replace smiley codes in HTML with `<img>` tags pointing to CDN-hosted GIFs.
 *
 * Handles:
 * - `{:2_NNN:}` → coolmonkey pack (IDs 133–148)
 * - `{:3_NNN:}` → comcom pack (IDs 149–172)
 * - `:name:` → default pack (24 named codes)
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

	// 3. Named :word:
	result = result.replace(RE_NAMED, (match, name) => {
		const file = NAMED_SMILEYS[name];
		return file ? smileyImg("default", file, match) : match;
	});

	return result;
}

// Export internals for testing
export { NAMED_SMILEY_SET, coolmonkeyFilename, comcomFilename };
