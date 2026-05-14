/**
 * PHP-serialized `pre_forum_forumfield.threadtypes` parser.
 *
 * Discuz stores per-forum 主题分类 (thread categories) configuration as a
 * PHP-serialized associative array in the `threadtypes` text column.
 * The shape is admin-edited via the AdminCP UI; values for the four
 * boolean keys (status/required/listable/prefix) drift across forums
 * because old admin paths wrote `b:0`/`b:1` while newer ones wrote
 * `s:1:"0"`/`s:1:"1"` — both must coerce to the same JS boolean.
 *
 * Sample (fid=134 / 跳蚤市场, current — `required`/`listable` as `b:1`,
 * `prefix` as `s:1:"1"`):
 *   a:6:{
 *     s:8:"required";b:1;
 *     s:8:"listable";b:1;
 *     s:6:"prefix";s:1:"1";
 *     s:5:"types";a:5:{i:561;s:12:"校园代理";...}
 *     s:5:"icons";a:5:{i:561;s:0:"";...}
 *     s:10:"moderators";a:5:{i:561;N;...}
 *   }
 *
 * Sample (fid=113 / 电脑技术, legacy — leading `i:0;b:0` junk, no
 * status/required/listable/prefix keys, but `types` keys are i:0/1/2
 * which ARE legitimate typeids in this forum, NOT "no-category"):
 *   a:3:{
 *     i:0;b:0;
 *     s:5:"types";a:3:{i:0;s:3:"PUB";i:1;s:3:"REQ";i:2;s:9:"Completed";}
 *     s:5:"icons";a:3:{i:0;s:0:"";i:1;s:0:"";i:2;s:0:"";}
 *   }
 *
 * Reviewer-pinned edge cases (covered by unit tests):
 *   1. `types` keys may be `i:0` — preserve as a real typeid (the forum
 *      may have an enabled category whose Discuz typeid is literally 0).
 *      When writing `threads.type_id`, callers still treat the per-thread
 *      `typeid=0` as "no category" — that semantics belongs to the
 *      thread-row mapper, not this parser.
 *   2. Boolean fields appear in two PHP serializations:
 *        b:0 / b:1            — native PHP bool
 *        s:1:"0" / s:1:"1"    — string-encoded admin-form value
 *      Both must coerce to the JS bool.
 *   3. `enabled` is derived from `types.size > 0`, NOT the legacy
 *      top-level `status` key. The admin write path stopped emitting
 *      `status` for re-saved forums (fid=134 + fid=147 have 5 admin
 *      categories each but no `status`); inferring "disabled" from a
 *      missing key would silently hide the category UI. The raw bit is
 *      preserved as `rawStatusEnabled` for dry-run sanity-check only.
 *
 * Byte-vs-char correctness:
 *   PHP serialize string lengths are byte counts (UTF-8 in this DB).
 *   JS string indexing is UTF-16 code units. A 4-character Chinese
 *   category name like "校园代理" is 12 bytes in PHP but length 4 in
 *   JS — slicing the JS string by 12 would walk past the end. We parse
 *   on a Uint8Array (UTF-8 bytes) and decode strings via TextDecoder.
 *
 * Deliberate non-goals:
 *   • Not a general PHP-unserialize implementation; only the keys this
 *     migration needs are extracted (status/required/listable/prefix +
 *     types + icons + moderators map).
 *   • The serialized payload may contain trailing junk after the array
 *     close brace; we anchor the top-level `a:N:{...}` and scan inside.
 */

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const TEXT_ENCODER = new TextEncoder();

/** Parsed result for one forum's `threadtypes` payload. */
export type ThreadTypesConfig = {
	/**
	 * forums.thread_types_enabled — true iff this forum currently has at
	 * least one admin-configured category. Derived from `types.size > 0`,
	 * NOT from the legacy top-level `status` key.
	 *
	 * Discuz's admin write path stopped emitting `status` somewhere along
	 * the way (fid=134 + fid=147 in the live dump are admin-re-saved
	 * forums with 5 categories each but no `status` key). Inferring
	 * enabled from `status` would silently disable the category UI on
	 * those forums; the load-side acceptance criterion (fid=134/147 must
	 * surface 5 enabled categories each) makes the `types`-derived
	 * definition authoritative.
	 *
	 * The raw legacy bit is preserved as `rawStatusEnabled` for the
	 * dry-run sanity check (parity between historical `status` and the
	 * new derivation) — callers should NOT consume it for any production
	 * decision.
	 */
	enabled: boolean;
	/** Raw `status` key value; informational only, see `enabled` doc. */
	rawStatusEnabled: boolean;
	/** forums.thread_types_required — selecting a type is mandatory. */
	required: boolean;
	/** forums.thread_types_listable — show category strip on forum index. */
	listable: boolean;
	/** forums.thread_types_prefix — category appears as `[name]` prefix in subjects. */
	prefix: boolean;
	/** typeid → display name; preserves `0` as a legitimate typeid (see header note). */
	types: Map<number, string>;
	/** typeid → icon path (often empty string). */
	icons: Map<number, string>;
	/** typeids configured as moderator-only (non-N value in `moderators` submap). */
	moderatorOnly: Set<number>;
};

/** Empty config used when the input is empty/null/unparseable. */
export const EMPTY_THREADTYPES_CONFIG: ThreadTypesConfig = Object.freeze({
	enabled: false,
	rawStatusEnabled: false,
	required: false,
	listable: false,
	prefix: false,
	types: new Map<number, string>(),
	icons: new Map<number, string>(),
	moderatorOnly: new Set<number>(),
}) as ThreadTypesConfig;

// ─── byte-level helpers ──────────────────────────────────────────────────────
// Char codes for the few ASCII bytes we need to detect during scanning.
const BYTE_OPEN = 0x7b; // {
const BYTE_CLOSE = 0x7d; // }
const BYTE_SEMI = 0x3b; // ;
const BYTE_QUOTE = 0x22; // "
const BYTE_a = 0x61; // a
const BYTE_b = 0x62; // b
const BYTE_d = 0x64; // d
const BYTE_i = 0x69; // i
const BYTE_s = 0x73; // s
const BYTE_N = 0x4e; // N (PHP null)

/** Read decimal digits starting at `start`; return [value, nextIndex]. */
function readDigits(bytes: Uint8Array, start: number): { value: number; next: number } {
	let i = start;
	let v = 0;
	while (i < bytes.length) {
		const c = bytes[i];
		if (c >= 0x30 && c <= 0x39) {
			v = v * 10 + (c - 0x30);
			i++;
		} else {
			break;
		}
	}
	return { value: v, next: i };
}

/** Find the byte index of the matching `}` for the `{` at `openBrace`. */
function findMatchingClose(bytes: Uint8Array, openBrace: number): number {
	// We can't just count `{`/`}` because string contents may contain
	// either character. Walk tokens by reading key/value pairs.
	let i = openBrace + 1;
	while (i < bytes.length) {
		if (bytes[i] === BYTE_CLOSE) return i;
		// Read key token, then value token.
		const keyEnd = readTokenEnd(bytes, i);
		i = keyEnd;
		if (bytes[i] === BYTE_SEMI) i++;
		const valEnd = readTokenEnd(bytes, i);
		i = valEnd;
		if (bytes[i] === BYTE_SEMI) i++;
	}
	return bytes.length;
}

/**
 * Read one PHP-serialized value/key token starting at byte `start`,
 * returning the index ONE PAST the token's last byte (i.e. pointing to
 * the trailing `;` for scalars, or to the byte after `}` for arrays).
 */
function readTokenEnd(bytes: Uint8Array, start: number): number {
	if (start >= bytes.length) return start;
	const c = bytes[start];
	// b:X / i:NNN / d:NNN — scan to next `;`
	if (c === BYTE_b || c === BYTE_i || c === BYTE_d) {
		let i = start;
		while (i < bytes.length && bytes[i] !== BYTE_SEMI) i++;
		return i;
	}
	// N (null literal) — exactly 1 byte
	if (c === BYTE_N) return start + 1;
	// s:N:"..." — declared byte length lets us jump past quotes safely
	if (c === BYTE_s) {
		// Format: s:<len>:"<bytes>"
		// start + 2 is the first digit of <len>
		const { value: len, next } = readDigits(bytes, start + 2);
		// next points to the `:`, then `"`, then content of `len` bytes, then `"`
		const contentStart = next + 2;
		return contentStart + len + 1; // +1 past closing quote
	}
	// a:N:{...} — walk braces using key/value tokens
	if (c === BYTE_a) {
		let i = start + 2;
		// Skip <count>: prefix
		while (i < bytes.length && bytes[i] !== BYTE_OPEN) i++;
		const close = findMatchingClose(bytes, i);
		return close + 1;
	}
	// Unknown — scan to `;`
	let i = start;
	while (i < bytes.length && bytes[i] !== BYTE_SEMI) i++;
	return i;
}

/**
 * Decode a `s:N:"..."` token starting at byte `start` to its inner
 * string content (UTF-8 → JS string). Returns null on malformed input.
 */
function decodePhpStringAt(bytes: Uint8Array, start: number): string | null {
	if (bytes[start] !== BYTE_s) return null;
	const { value: len, next } = readDigits(bytes, start + 2);
	const contentStart = next + 2; // skip `:` then `"`
	if (contentStart + len > bytes.length) return null;
	return TEXT_DECODER.decode(bytes.subarray(contentStart, contentStart + len));
}

/**
 * Decode an `i:NNN` token starting at byte `start`. Returns null if not
 * an integer token.
 */
function decodePhpIntAt(bytes: Uint8Array, start: number): number | null {
	if (bytes[start] !== BYTE_i) return null;
	// i:NNN — start+2 is first digit, may be `-` for negatives (not seen here but handle gracefully)
	let i = start + 2;
	let sign = 1;
	if (bytes[i] === 0x2d) {
		sign = -1;
		i++;
	}
	const { value, next } = readDigits(bytes, i);
	if (next === i) return null;
	return sign * value;
}

/**
 * Walk an `a:N:{...}` array body and call `onEntry(keyStart, valueStart)`
 * for each entry. Indexes are into the byte buffer.
 */
function walkArrayEntries(
	bytes: Uint8Array,
	arrayStart: number,
	onEntry: (keyStart: number, valueStart: number) => void,
): void {
	// Locate the `{`
	let i = arrayStart + 2;
	while (i < bytes.length && bytes[i] !== BYTE_OPEN) i++;
	i++; // past `{`
	while (i < bytes.length && bytes[i] !== BYTE_CLOSE) {
		const keyStart = i;
		const keyEnd = readTokenEnd(bytes, i);
		i = keyEnd;
		if (bytes[i] === BYTE_SEMI) i++;
		const valueStart = i;
		const valueEnd = readTokenEnd(bytes, i);
		onEntry(keyStart, valueStart);
		i = valueEnd;
		if (bytes[i] === BYTE_SEMI) i++;
	}
}

/**
 * Walk the top-level `a:N:{...}` body and locate the value byte-range
 * for a given string key. Returns the [valueStart, valueEnd) byte range
 * or null if the key isn't present at top level. Depth-aware because
 * `types`/`icons`/`moderators` values themselves are arrays.
 */
/**
 * Compare bytes at `pos` against the literal byte sequence `needle`.
 * Returns true if `needle` matches byte-for-byte starting at `pos`.
 */
function bytesEqualAt(bytes: Uint8Array, pos: number, needle: Uint8Array): boolean {
	if (pos + needle.length > bytes.length) return false;
	for (let k = 0; k < needle.length; k++) {
		if (bytes[pos + k] !== needle[k]) return false;
	}
	return true;
}

/**
 * Check whether the key token at `[keyStart, keyEnd)` is `s:<n>:"<key>"`.
 *
 * Split out from `findTopLevelKeyRange` to keep that scanner's cognitive
 * complexity below the project lint threshold — the cross-byte compare
 * is straightforward in isolation but adds nested branches inline.
 */
function keyTokenMatches(
	bytes: Uint8Array,
	keyStart: number,
	keyEnd: number,
	prefix: Uint8Array,
	keyBytes: Uint8Array,
): boolean {
	// `s:N:"key"` is prefix.length + keyBytes.length + 1 closing-quote byte.
	if (keyEnd - keyStart !== prefix.length + keyBytes.length + 1) return false;
	if (!bytesEqualAt(bytes, keyStart, prefix)) return false;
	if (!bytesEqualAt(bytes, keyStart + prefix.length, keyBytes)) return false;
	return bytes[keyStart + prefix.length + keyBytes.length] === BYTE_QUOTE;
}

/**
 * Walk the top-level `a:N:{...}` body and locate the value byte-range
 * for a given string key. Returns the [valueStart, valueEnd) byte range
 * or null if the key isn't present at top level. Depth-aware because
 * `types`/`icons`/`moderators` values themselves are arrays.
 */
function findTopLevelKeyRange(
	bytes: Uint8Array,
	arrayStart: number,
	key: string,
): { start: number; end: number } | null {
	const keyBytes = TEXT_ENCODER.encode(key);
	// `s:<len>:"key";` prefix
	const prefix = TEXT_ENCODER.encode(`s:${keyBytes.length}:"`);
	let i = arrayStart + 2;
	while (i < bytes.length && bytes[i] !== BYTE_OPEN) i++;
	i++; // past `{`
	while (i < bytes.length && bytes[i] !== BYTE_CLOSE) {
		const keyStart = i;
		const keyEnd = readTokenEnd(bytes, i);
		i = keyEnd;
		if (bytes[i] === BYTE_SEMI) i++;
		const valueStart = i;
		const valueEnd = readTokenEnd(bytes, i);
		if (keyTokenMatches(bytes, keyStart, keyEnd, prefix, keyBytes)) {
			return { start: valueStart, end: valueEnd };
		}
		i = valueEnd;
		if (bytes[i] === BYTE_SEMI) i++;
	}
	return null;
}

/**
 * Coerce a PHP-serialized boolean byte-range to JS bool, accepting both
 * `b:0`/`b:1` and `s:1:"0"`/`s:1:"1"`. Any other shape → `false`.
 *
 * Exported variant (string input) for direct unit testing — the dual-form
 * is the reviewer's pin #2 and a known historical foot-gun (older admin
 * code wrote the `s:1:"1"` form for `prefix`/`status` while newer code
 * emits `b:1`).
 */
export function coerceSerializedBool(raw: string | undefined): boolean {
	if (!raw) return false;
	const s = raw.trim();
	if (s === "b:1") return true;
	if (s === 's:1:"1"') return true;
	return false;
}

function coerceBoolByteRange(bytes: Uint8Array, start: number, end: number): boolean {
	const slice = TEXT_DECODER.decode(bytes.subarray(start, end));
	return coerceSerializedBool(slice);
}

/**
 * Decode a key token in `[start, end)` to a numeric typeid.
 *
 * - `i:NNN`        → NNN (preserves `0` per reviewer pin #1).
 * - `s:N:"NNN"`    → NNN (admin form sometimes emits string-typed keys).
 * - anything else  → null (skip; not a valid typeid).
 */
function keyByteRangeToTypeId(bytes: Uint8Array, start: number, _end: number): number | null {
	const c = bytes[start];
	if (c === BYTE_i) {
		return decodePhpIntAt(bytes, start);
	}
	if (c === BYTE_s) {
		const inner = decodePhpStringAt(bytes, start);
		if (inner === null) return null;
		const n = Number.parseInt(inner, 10);
		return Number.isFinite(n) && String(n) === inner ? n : null;
	}
	return null;
}

/**
 * Parse the `threadtypes` text column. Returns `EMPTY_THREADTYPES_CONFIG`
 * (all booleans `false`, empty maps) for null/empty/unparseable input —
 * matches Discuz semantics where a forum with no admin-configured
 * categories has no payload.
 */
export function parseThreadTypes(raw: string | null | undefined): ThreadTypesConfig {
	if (!raw) return EMPTY_THREADTYPES_CONFIG;
	const trimmed = raw.trim();
	if (!trimmed.startsWith("a:")) return EMPTY_THREADTYPES_CONFIG;
	const bytes = TEXT_ENCODER.encode(trimmed);

	const statusRange = findTopLevelKeyRange(bytes, 0, "status");
	const requiredRange = findTopLevelKeyRange(bytes, 0, "required");
	const listableRange = findTopLevelKeyRange(bytes, 0, "listable");
	const prefixRange = findTopLevelKeyRange(bytes, 0, "prefix");
	const typesRange = findTopLevelKeyRange(bytes, 0, "types");
	const iconsRange = findTopLevelKeyRange(bytes, 0, "icons");
	const moderatorsRange = findTopLevelKeyRange(bytes, 0, "moderators");

	const types = new Map<number, string>();
	if (typesRange && bytes[typesRange.start] === BYTE_a) {
		walkArrayEntries(bytes, typesRange.start, (keyStart, valueStart) => {
			const keyEnd = readTokenEnd(bytes, keyStart);
			const typeid = keyByteRangeToTypeId(bytes, keyStart, keyEnd);
			if (typeid === null) return;
			if (bytes[valueStart] !== BYTE_s) return;
			const name = decodePhpStringAt(bytes, valueStart);
			if (name) types.set(typeid, name);
		});
	}

	const icons = new Map<number, string>();
	if (iconsRange && bytes[iconsRange.start] === BYTE_a) {
		walkArrayEntries(bytes, iconsRange.start, (keyStart, valueStart) => {
			const keyEnd = readTokenEnd(bytes, keyStart);
			const typeid = keyByteRangeToTypeId(bytes, keyStart, keyEnd);
			if (typeid === null) return;
			if (bytes[valueStart] !== BYTE_s) return;
			const icon = decodePhpStringAt(bytes, valueStart) ?? "";
			icons.set(typeid, icon);
		});
	}

	const moderatorOnly = new Set<number>();
	if (moderatorsRange && bytes[moderatorsRange.start] === BYTE_a) {
		walkArrayEntries(bytes, moderatorsRange.start, (keyStart, valueStart) => {
			const keyEnd = readTokenEnd(bytes, keyStart);
			const typeid = keyByteRangeToTypeId(bytes, keyStart, keyEnd);
			if (typeid === null) return;
			// `N` (null) → not moderator-only; anything else (non-empty
			// string, etc.) → yes. Discuz's admin UI only writes a
			// non-null value when the toggle is on.
			const v0 = bytes[valueStart];
			if (v0 === BYTE_N) return;
			if (v0 === BYTE_s) {
				const inner = decodePhpStringAt(bytes, valueStart);
				if (inner) moderatorOnly.add(typeid);
			} else {
				moderatorOnly.add(typeid);
			}
		});
	}

	return {
		enabled: types.size > 0,
		rawStatusEnabled: statusRange
			? coerceBoolByteRange(bytes, statusRange.start, statusRange.end)
			: false,
		required: requiredRange
			? coerceBoolByteRange(bytes, requiredRange.start, requiredRange.end)
			: false,
		listable: listableRange
			? coerceBoolByteRange(bytes, listableRange.start, listableRange.end)
			: false,
		prefix: prefixRange ? coerceBoolByteRange(bytes, prefixRange.start, prefixRange.end) : false,
		types,
		icons,
		moderatorOnly,
	};
}
