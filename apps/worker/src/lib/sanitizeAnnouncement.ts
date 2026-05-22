// Zero-dependency HTML sanitizer for forum announcement payloads.
//
// Why a custom sanitizer instead of DOMPurify?
// - The Worker runtime has no DOM. `apps/web/src/lib/content-filter.ts`
//   wires DOMPurify against `linkedom` which the existing code already
//   warns is a silent no-op on certain element shapes
//   (see content-filter.ts:257 — "We do NOT use DOMPurify here because
//   the linkedom-backed DOMPurify in this file is a silent no-op …").
//   We don't want that risk on the **write path** for moderator content.
// - The forum announcement allowlist is small and stable
//   (welcome line + link index + 版规 markup), so a hand-rolled
//   whitelist tokenizer is both simpler and easier to audit than a
//   full DOM-aware sanitizer.
//
// The same function is reused by the data backfill script so the SQL
// emitted to D1 and the live PATCH endpoint apply identical rules.
//
// Allowlist (everything else is dropped, including the opening tag):
//   structural : p, br, span, ul, ol, li
//   inline     : strong, em, b, i, u, font, a, img
//   attrs      :
//     a       — href, target, rel, title
//     img     — src, alt, width, height
//     font    — color (named or #rgb/#rrggbb only)
//     others  — class is dropped; data-*/aria-* dropped; on* always dropped.
// URL schemes accepted on href/src: `http:`, `https:`, `mailto:`, and
// site-relative paths starting with `/`. Anything else (javascript:,
// data:, vbscript:, file:, ftp:, fragment-only #foo, etc.) → drop the
// attribute. Mixed-case schemes are normalised before the check, and
// HTML/URL entity confusables (e.g. `&#x6a;avascript:`) are decoded
// first so `&#x6a;avascript:foo` cannot smuggle past the filter.
//
// Output post-conditions:
//   1. No NUL bytes or other C0 control chars except `\t \n \r`.
//   2. Every `<a>` carries `rel="nofollow noopener"` and `target="_blank"`.
//   3. No `<script> <style> <iframe> <object> <embed> <form> <base>
//      <meta> <link> <svg> <math>` survives, including via comments,
//      CDATA, or processing instructions (all stripped wholesale).
//   4. All `on*=` attributes are removed regardless of tag.

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
	"p",
	"br",
	"span",
	"ul",
	"ol",
	"li",
	"strong",
	"em",
	"b",
	"i",
	"u",
	"font",
	"a",
	"img",
]);

const VOID_TAGS: ReadonlySet<string> = new Set(["br", "img"]);

// Tags whose entire contents (raw text) must be discarded, not parsed
// as HTML. We do NOT keep their text because that text is hostile by
// definition (e.g. JS source, CSS rules).
const RAW_DROP_TAGS: ReadonlySet<string> = new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"form",
	"base",
	"meta",
	"link",
	"svg",
	"math",
	"template",
	"noscript",
	"title",
]);

// Per-tag attribute allowlist. Keys are lowercase tag, values are sets
// of lowercase attribute names.
const ATTR_ALLOWLIST: Record<string, ReadonlySet<string>> = {
	a: new Set(["href", "title"]), // target/rel forced; class/style dropped
	img: new Set(["src", "alt", "width", "height"]),
	font: new Set(["color"]),
};

// Conservative subset of CSS named colors plus hex; everything else
// rejected so a moderator cannot accidentally smuggle `expression(...)`
// or `url(...)` payloads through `color`.
const NAMED_COLOR_PATTERN = /^[a-z]{3,20}$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function isSafeColor(value: string): boolean {
	const v = value.trim();
	if (HEX_COLOR_PATTERN.test(v)) return true;
	if (NAMED_COLOR_PATTERN.test(v)) return true;
	return false;
}

const NAMED_ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	colon: ":",
	sol: "/",
	tab: "\t",
	nbsp: " ",
};

function decodeNumericEntity(lower: string): string | null {
	if (lower.startsWith("#x")) {
		const code = Number.parseInt(lower.slice(2), 16);
		if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
			return String.fromCodePoint(code);
		}
		return null;
	}
	if (lower.startsWith("#")) {
		const code = Number.parseInt(lower.slice(1), 10);
		if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
			return String.fromCodePoint(code);
		}
	}
	return null;
}

/** Decode a small set of numeric and named HTML entities so the
 * sanitizer's output is canonical (not double-escaped). The same
 * routine guards URL attributes against scheme confusables
 * (`&#x6a;avascript:`, `&#106;avascript:`, `&colon;`) AND defeats the
 * round-trip bug where legacy `&amp;` in href becomes `&amp;amp;` after
 * re-escaping. We deliberately do NOT decode here for use during tag
 * tokenisation — the tokenizer needs raw angle brackets to detect tag
 * boundaries; decoding happens at the output stage instead.
 */
function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (m, body: string) => {
		const lower = body.toLowerCase();
		const named = NAMED_ENTITY_MAP[lower];
		if (named !== undefined) return named;
		const numeric = decodeNumericEntity(lower);
		if (numeric !== null) return numeric;
		return m;
	});
}

// Strip C0 control chars (0x00–0x1f) and DEL (0x7f). Done char-by-char
// instead of via a control-char regex so biome's
// `noControlCharactersInRegex` lint stays happy without inline ignores.
function stripControlCharsForUrl(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c <= 0x1f || c === 0x7f) continue;
		out += s[i];
	}
	return out;
}

function isSafeUrl(rawValue: string): boolean {
	// Strip leading/trailing whitespace AND any C0 control chars first;
	// browsers will, and `javascript:` would otherwise tunnel
	// through. Decode entities so the scheme check sees the real string.
	const decoded = stripControlCharsForUrl(decodeEntities(rawValue));
	const trimmed = decoded.trim();
	if (trimmed === "") return false;
	// Site-relative
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
	// Protocol-relative not allowed — would inherit the host's scheme
	// and we want explicit https.
	if (trimmed.startsWith("//")) return false;
	// Fragment-only / query-only — disallow; legacy content shouldn't
	// rely on host-relative fragments and the value is rarely safe.
	if (trimmed.startsWith("#") || trimmed.startsWith("?")) return false;
	const colon = trimmed.indexOf(":");
	if (colon === -1) {
		// No scheme, not site-relative → could be `foo.html`; reject so
		// the announcement field stays unambiguous.
		return false;
	}
	const scheme = trimmed.slice(0, colon).toLowerCase();
	return scheme === "http" || scheme === "https" || scheme === "mailto";
}

interface Attr {
	name: string;
	value: string;
}

const WS = /\s/;

function isWs(ch: string): boolean {
	return WS.test(ch);
}

function skipWs(inside: string, start: number): number {
	let i = start;
	while (i < inside.length && isWs(inside[i])) i++;
	return i;
}

function readAttrName(inside: string, start: number): { name: string; next: number } {
	let i = start;
	while (i < inside.length) {
		const ch = inside[i];
		if (isWs(ch) || ch === "=" || ch === ">") break;
		i++;
	}
	return { name: inside.slice(start, i), next: i };
}

function readQuotedValue(
	inside: string,
	start: number,
	quote: string,
): { value: string; next: number } {
	let i = start;
	while (i < inside.length && inside[i] !== quote) i++;
	const value = inside.slice(start, i);
	if (i < inside.length) i++; // consume closing quote
	return { value, next: i };
}

function readUnquotedValue(inside: string, start: number): { value: string; next: number } {
	let i = start;
	while (i < inside.length) {
		const ch = inside[i];
		if (isWs(ch) || ch === ">") break;
		i++;
	}
	return { value: inside.slice(start, i), next: i };
}

function readAttrValue(inside: string, start: number): { value: string; next: number } {
	const i = skipWs(inside, start);
	const ch = inside[i];
	if (ch === '"' || ch === "'") return readQuotedValue(inside, i + 1, ch);
	return readUnquotedValue(inside, i);
}

// Parse `name="..."` / `name='...'` / `name=value` / `name` attribute
// list out of the raw inside-the-tag string. Quotes are required to
// contain embedded `>` and `=`; unquoted values stop at whitespace.
function parseAttrs(inside: string): Attr[] {
	const out: Attr[] = [];
	let i = 0;
	const len = inside.length;
	while (i < len) {
		i = skipWs(inside, i);
		if (i >= len) break;
		const { name, next: afterName } = readAttrName(inside, i);
		if (name === "") break;
		i = skipWs(inside, afterName);
		let value = "";
		if (inside[i] === "=") {
			const { value: v, next } = readAttrValue(inside, i + 1);
			value = v;
			i = next;
		}
		out.push({ name: name.toLowerCase(), value });
	}
	return out;
}

// Output escape routines. We decode any HTML entities the input
// already contained, then re-escape the structural specials. This
// makes the sanitizer idempotent — running it twice on the same
// content produces identical bytes — and stops legacy `&amp;` from
// becoming `&amp;amp;` on every round-trip. Decoding is safe because
// the tag tokenizer has already split structural `<`/`>` from text
// content; only entity sequences remain to be normalised here.
function escapeAttrValue(v: string): string {
	return decodeEntities(v)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeText(t: string): string {
	return decodeEntities(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SanitizeStats {
	droppedTags: Record<string, number>;
	droppedAttrs: Record<string, number>;
	droppedUrls: number;
	nulRemoved: number;
}

export interface SanitizeResult {
	html: string;
	stats: SanitizeStats;
}

// Drop attributes that are NEVER safe regardless of tag.
function isBannedAttr(name: string): boolean {
	return (
		name.startsWith("on") ||
		name.startsWith("xmlns") ||
		name.includes(":") ||
		name === "style" ||
		name === "class" ||
		name === "id"
	);
}

function bumpStat(map: Record<string, number>, key: string): void {
	map[key] = (map[key] ?? 0) + 1;
}

function isAttrValueAcceptable(name: string, value: string): boolean {
	if (name === "href" || name === "src") return isSafeUrl(value);
	if (name === "color") return isSafeColor(value);
	if (name === "width" || name === "height") return /^\d{1,4}%?$/.test(value.trim());
	return true;
}

function filterAttrs(
	attrs: Attr[],
	tagName: string,
	tagAllow: ReadonlySet<string> | undefined,
	stats: SanitizeStats,
): Attr[] {
	const safe: Attr[] = [];
	for (const a of attrs) {
		if (isBannedAttr(a.name)) {
			bumpStat(stats.droppedAttrs, `${tagName}.${a.name}`);
			continue;
		}
		if (!tagAllow || !tagAllow.has(a.name)) {
			bumpStat(stats.droppedAttrs, `${tagName}.${a.name}`);
			continue;
		}
		if (!isAttrValueAcceptable(a.name, a.value)) {
			if (a.name === "href" || a.name === "src") stats.droppedUrls++;
			else bumpStat(stats.droppedAttrs, `${tagName}.${a.name}`);
			continue;
		}
		safe.push(a);
	}
	return safe;
}

// Strip C0 control chars except \t \n \r. Counts NUL separately so the
// dry-run report can flag NUL-containing legacy entries.
function stripBodyControls(raw: string, stats: SanitizeStats): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const c = raw.charCodeAt(i);
		if (c === 0) {
			stats.nulRemoved++;
			continue;
		}
		if (c === 9 || c === 10 || c === 13) {
			out += raw[i];
			continue;
		}
		if (c < 32 || c === 0x7f) continue;
		out += raw[i];
	}
	return out;
}

function stripMetaMarkup(s: string): string {
	return s
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
		.replace(/<![^>]*>/g, "")
		.replace(/<\?[\s\S]*?\?>/g, "");
}

interface TokenizerState {
	input: string;
	i: number;
	out: string[];
	stack: string[];
	stats: SanitizeStats;
}

// Quote-aware scan for the closing `>` of a tag. A bare `>` inside a
// quoted attribute value (e.g. `title="a>b"`) does NOT terminate the
// tag — browsers consume the quoted value first and only treat the
// next unquoted `>` as the end. Returns -1 if no terminator exists.
function findTagEnd(input: string, from: number): number {
	let quote: '"' | "'" | null = null;
	for (let i = from; i < input.length; i++) {
		const ch = input[i];
		if (quote !== null) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === ">") return i;
	}
	return -1;
}

function handleLooseLessThan(st: TokenizerState): boolean {
	const peek = st.input[st.i + 1];
	if (
		peek === undefined ||
		!(peek === "/" || peek === "!" || peek === "?" || /[a-zA-Z]/.test(peek))
	) {
		st.out.push("&lt;");
		st.i++;
		return true;
	}
	return false;
}

function emitTextUpToNextTag(st: TokenizerState): void {
	const next = st.input.indexOf("<", st.i);
	const end = next === -1 ? st.input.length : next;
	st.out.push(escapeText(st.input.slice(st.i, end)));
	st.i = end;
}

function consumeEndTag(st: TokenizerState, tagBody: string): void {
	const nameMatch = tagBody.slice(1).match(/^[a-z][a-z0-9]*/i);
	if (!nameMatch) return;
	const name = nameMatch[0].toLowerCase();
	if (
		ALLOWED_TAGS.has(name) &&
		!VOID_TAGS.has(name) &&
		st.stack.length > 0 &&
		st.stack[st.stack.length - 1] === name
	) {
		st.stack.pop();
		st.out.push(`</${name}>`);
	}
}

function skipRawDropContent(st: TokenizerState, name: string): void {
	const closeRe = new RegExp(`</\\s*${name}\\s*>`, "i");
	const rest = st.input.slice(st.i);
	const m = rest.match(closeRe);
	if (m && m.index !== undefined) {
		st.i += m.index + m[0].length;
	} else {
		st.i = st.input.length;
	}
	bumpStat(st.stats.droppedTags, name);
}

function emitOpenTag(
	st: TokenizerState,
	name: string,
	safeAttrs: Attr[],
	isVoid: boolean,
	selfClosing: boolean,
): void {
	const attrStr = safeAttrs.length
		? ` ${safeAttrs.map((a) => `${a.name}="${escapeAttrValue(a.value)}"`).join(" ")}`
		: "";
	if (isVoid) {
		st.out.push(`<${name}${attrStr} />`);
		return;
	}
	st.out.push(`<${name}${attrStr}>`);
	if (selfClosing) {
		st.out.push(`</${name}>`);
	} else {
		st.stack.push(name);
	}
}

// Anchor / img special-case requirements: `<a>` requires href; `<img>`
// requires src. Either missing → drop the entire tag.
function finalizeAnchorOrImg(name: string, safeAttrs: Attr[], stats: SanitizeStats): Attr[] | null {
	if (name === "a") {
		if (!safeAttrs.some((a) => a.name === "href")) {
			bumpStat(stats.droppedTags, "a");
			return null;
		}
		safeAttrs.push({ name: "rel", value: "nofollow noopener" });
		safeAttrs.push({ name: "target", value: "_blank" });
		return safeAttrs;
	}
	if (name === "img") {
		if (!safeAttrs.some((a) => a.name === "src")) {
			bumpStat(stats.droppedTags, "img");
			return null;
		}
	}
	return safeAttrs;
}

function consumeStartTag(st: TokenizerState, tagBody: string): void {
	const nameMatch = tagBody.match(/^[a-z][a-z0-9]*/i);
	if (!nameMatch) return;
	const name = nameMatch[0].toLowerCase();

	if (RAW_DROP_TAGS.has(name)) {
		skipRawDropContent(st, name);
		return;
	}
	if (!ALLOWED_TAGS.has(name)) {
		bumpStat(st.stats.droppedTags, name);
		return;
	}

	const isVoid = VOID_TAGS.has(name);
	const selfClosing = tagBody.endsWith("/");
	let attrPart = tagBody.slice(nameMatch[0].length);
	if (selfClosing) attrPart = attrPart.slice(0, -1);

	const safeAttrs = filterAttrs(parseAttrs(attrPart), name, ATTR_ALLOWLIST[name], st.stats);
	const finalized = finalizeAnchorOrImg(name, safeAttrs, st.stats);
	if (finalized === null) return;

	emitOpenTag(st, name, finalized, isVoid, selfClosing);
}

/**
 * Sanitize a forum-announcement HTML string into the safe subset
 * documented at the top of this file. Pure / deterministic / no IO.
 */
export function sanitizeForumAnnouncement(raw: string): SanitizeResult {
	const stats: SanitizeStats = {
		droppedTags: {},
		droppedAttrs: {},
		droppedUrls: 0,
		nulRemoved: 0,
	};

	const input = stripMetaMarkup(stripBodyControls(raw, stats));
	const st: TokenizerState = { input, i: 0, out: [], stack: [], stats };
	const len = input.length;

	while (st.i < len) {
		const ch = input[st.i];
		if (ch !== "<") {
			emitTextUpToNextTag(st);
			continue;
		}
		if (handleLooseLessThan(st)) continue;

		const close = findTagEnd(input, st.i + 1);
		if (close === -1) {
			st.out.push(escapeText(input.slice(st.i)));
			break;
		}
		const tagBody = input.slice(st.i + 1, close);
		st.i = close + 1;
		if (tagBody.length === 0) continue;

		if (tagBody[0] === "/") {
			consumeEndTag(st, tagBody);
			continue;
		}
		consumeStartTag(st, tagBody);
	}

	while (st.stack.length > 0) {
		st.out.push(`</${st.stack.pop()}>`);
	}

	return { html: st.out.join(""), stats };
}

/** Max byte length accepted for `forums.announcement`. The longest
 * legacy entry is 1459 chars; 4 KiB leaves comfortable headroom for
 * moderator edits that add a few links. UTF-8 length, not char count.
 */
export const ANNOUNCEMENT_MAX_BYTES = 4096;

export interface AnnouncementValidation {
	ok: boolean;
	code?: "TOO_LONG" | "INVALID_TYPE";
	html?: string;
	stats?: SanitizeStats;
}

/**
 * Validate + sanitize an inbound announcement string. Returns either
 * the sanitized HTML or an error code suitable for translating into a
 * 4xx response. Empty input is legal and clears the announcement.
 */
export function prepareAnnouncement(raw: unknown): AnnouncementValidation {
	if (typeof raw !== "string") {
		return { ok: false, code: "INVALID_TYPE" };
	}
	const { html, stats } = sanitizeForumAnnouncement(raw);
	// Length check post-sanitize so a moderator can submit slightly
	// oversized input that sanitizes back into the budget. Conversely
	// they can't sneak past the budget by writing junk that sanitizes
	// out — the cleaned output is what the column will store.
	if (new TextEncoder().encode(html).byteLength > ANNOUNCEMENT_MAX_BYTES) {
		return { ok: false, code: "TOO_LONG" };
	}
	return { ok: true, html, stats };
}
