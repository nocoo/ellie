// Rich-HTML whitelist sanitizer for forum announcement preview + render.
//
// Mirrors the Worker-side allowlist in
// `apps/worker/src/lib/sanitizeAnnouncement.ts`. The Worker is the
// authoritative security boundary; this client-side sanitizer exists
// for two reasons:
//   1. live preview inside `AnnouncementEditDialog` (moderator typing).
//   2. defense-in-depth render on the public forum page in case a
//      pre-sanitizer pipeline regression ever lands raw HTML in the
//      `announcement` column.
//
// Differences vs `lib/safe-html.ts`:
//   - allows `<p> <br> <ul> <ol> <li> <span> <img> <font>`.
//   - quote-aware tag boundary scanner (so `title="a>b"` doesn't
//     prematurely terminate the tag — same bug fixed on the Worker
//     side at commit ece753f4).
//   - URL allowlist: http / https / mailto / site-relative; rejects
//     `javascript:` `data:` `vbscript:` and entity confusables.
//
// IMPORTANT: do NOT extend `sanitizeInlineHtml` in `lib/safe-html.ts`
// — that one is used by post bodies / thread titles where `<img>` is
// not allowed, and widening its allowlist would silently let images
// into those surfaces.

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

const ATTR_ALLOWLIST: Record<string, ReadonlySet<string>> = {
	a: new Set(["href", "title"]),
	img: new Set(["src", "alt", "width", "height"]),
	font: new Set(["color"]),
};

const NAMED_COLOR_PATTERN = /^[a-z]{3,20}$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function isSafeColor(value: string): boolean {
	const v = value.trim();
	return HEX_COLOR_PATTERN.test(v) || NAMED_COLOR_PATTERN.test(v);
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
	nbsp: " ",
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

function decodeAttrEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (m, body: string) => {
		const lower = body.toLowerCase();
		const named = NAMED_ENTITY_MAP[lower];
		if (named !== undefined) return named;
		const numeric = decodeNumericEntity(lower);
		if (numeric !== null) return numeric;
		return m;
	});
}

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
	const decoded = stripControlCharsForUrl(decodeAttrEntities(rawValue));
	const trimmed = decoded.trim();
	if (trimmed === "") return false;
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
	if (trimmed.startsWith("//")) return false;
	if (trimmed.startsWith("#") || trimmed.startsWith("?")) return false;
	const colon = trimmed.indexOf(":");
	if (colon === -1) return false;
	const scheme = trimmed.slice(0, colon).toLowerCase();
	return scheme === "http" || scheme === "https" || scheme === "mailto";
}

interface Attr {
	name: string;
	value: string;
}

const WS = /\s/;
const isWs = (ch: string) => WS.test(ch);

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
	if (i < inside.length) i++;
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

function escapeAttrValue(v: string): string {
	return v
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeText(t: string): string {
	return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function isAttrValueAcceptable(name: string, value: string): boolean {
	if (name === "href" || name === "src") return isSafeUrl(value);
	if (name === "color") return isSafeColor(value);
	if (name === "width" || name === "height") return /^\d{1,4}%?$/.test(value.trim());
	return true;
}

function filterAttrs(attrs: Attr[], tagAllow: ReadonlySet<string> | undefined): Attr[] {
	const safe: Attr[] = [];
	for (const a of attrs) {
		if (isBannedAttr(a.name)) continue;
		if (!tagAllow || !tagAllow.has(a.name)) continue;
		if (!isAttrValueAcceptable(a.name, a.value)) continue;
		safe.push(a);
	}
	return safe;
}

function stripBodyControls(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const c = raw.charCodeAt(i);
		if (c === 0) continue;
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
}

// Quote-aware scan for the closing `>` of a tag. A bare `>` inside a
// quoted attribute value (e.g. `title="a>b"`) does NOT terminate the
// tag. Mirror of the Worker fix at `sanitizeAnnouncement.ts:findTagEnd`.
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

function finalizeAnchorOrImg(name: string, safeAttrs: Attr[]): Attr[] | null {
	if (name === "a") {
		if (!safeAttrs.some((a) => a.name === "href")) return null;
		safeAttrs.push({ name: "rel", value: "nofollow noopener" });
		safeAttrs.push({ name: "target", value: "_blank" });
		return safeAttrs;
	}
	if (name === "img") {
		if (!safeAttrs.some((a) => a.name === "src")) return null;
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
	if (!ALLOWED_TAGS.has(name)) return;

	const isVoid = VOID_TAGS.has(name);
	const selfClosing = tagBody.endsWith("/");
	let attrPart = tagBody.slice(nameMatch[0].length);
	if (selfClosing) attrPart = attrPart.slice(0, -1);

	const safeAttrs = filterAttrs(parseAttrs(attrPart), ATTR_ALLOWLIST[name]);
	const finalized = finalizeAnchorOrImg(name, safeAttrs);
	if (finalized === null) return;

	emitOpenTag(st, name, finalized, isVoid, selfClosing);
}

/**
 * Sanitize a forum-announcement HTML string for preview / render.
 * Pure / deterministic. The Worker is still the authoritative
 * sanitizer on the write path — this is for preview UX + defense-in-depth.
 */
export function sanitizeRichHtml(raw: string | undefined | null): string {
	if (!raw) return "";

	const input = stripMetaMarkup(stripBodyControls(raw));
	const st: TokenizerState = { input, i: 0, out: [], stack: [] };
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

	return st.out.join("");
}
