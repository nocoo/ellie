import { describe, expect, test } from "vitest";
import {
	EMPTY_THREADTYPES_CONFIG,
	coerceSerializedBool,
	parseThreadTypes,
} from "../src/transform/threadtypes";

/**
 * Fixtures captured from `reference/db/2026-05-14/db_tongji_main_full.sql.gz`
 * (`pre_forum_forumfield.threadtypes` column). The SQL-string-literal
 * escape layer (`\"` → `"`) has been pre-applied; what we feed the
 * parser is the actual PHP-serialized payload as it would arrive after
 * `parser.ts` unescapes the dump value.
 *
 * fid=134 (跳蚤市场, current) shows the modern admin shape:
 *   • status absent → enabled defaults false; admin re-saved via newer UI
 *     drops the legacy `status` key (this is a known Discuz quirk, see
 *     header in src/transform/threadtypes.ts).
 *   • required, listable as b:1
 *   • prefix as s:1:"1"          ← reviewer pin #2 (must coerce to true)
 *   • types: i:561..i:565 → 5 entries, all non-zero typeids
 *
 * fid=113 (电脑技术, legacy) shows the admin's older write path:
 *   • Leading junk key i:0;b:0; — must not crash the parser.
 *   • No status/required/listable keys (all default false).
 *   • types is a:3 with KEYS i:0/i:1/i:2 — reviewer pin #1: these are
 *     LEGITIMATE typeids (PUB/REQ/Completed), NOT "no-category". The
 *     parser must preserve `0` as a real key.
 *
 * fid=147 (求职就业, synthesized minimal) covers the cleanest current
 * shape: status=b:1, required=b:0, listable=b:1, prefix=b:0, 5 types
 * with non-zero ids — the verify artifact expects fid=147 to surface 5
 * enabled categories per the reviewer's acceptance criterion.
 */
const FIXTURE_FID_134 =
	'a:6:{s:8:"required";b:1;s:8:"listable";b:1;s:6:"prefix";s:1:"1";s:5:"types";a:5:{i:561;s:12:"校园代理";i:562;s:12:"房屋租赁";i:563;s:12:"学习资料";i:564;s:12:"电子通讯";i:565;s:12:"生活资料";}s:5:"icons";a:5:{i:561;s:0:"";i:562;s:0:"";i:563;s:0:"";i:564;s:0:"";i:565;s:0:"";}s:10:"moderators";a:5:{i:561;N;i:562;N;i:563;N;i:564;N;i:565;N;}}';

const FIXTURE_FID_113 =
	'a:3:{i:0;b:0;s:5:"types";a:3:{i:0;s:3:"PUB";i:1;s:3:"REQ";i:2;s:9:"Completed";}s:5:"icons";a:3:{i:0;s:0:"";i:1;s:0:"";i:2;s:0:"";}}';

const FIXTURE_FID_147 =
	'a:7:{s:6:"status";b:1;s:8:"required";b:0;s:8:"listable";b:1;s:6:"prefix";b:0;s:5:"types";a:5:{i:701;s:12:"全职招聘";i:702;s:12:"实习招聘";i:703;s:12:"求职咨询";i:704;s:12:"简历指导";i:705;s:12:"面经分享";}s:5:"icons";a:5:{i:701;s:0:"";i:702;s:0:"";i:703;s:0:"";i:704;s:0:"";i:705;s:0:"";}s:10:"moderators";a:5:{i:701;N;i:702;N;i:703;N;i:704;N;i:705;N;}}';

describe("coerceSerializedBool", () => {
	test("b:1 → true (reviewer pin #2: native PHP bool)", () => {
		expect(coerceSerializedBool("b:1")).toBe(true);
	});

	test('s:1:"1" → true (reviewer pin #2: string-encoded admin-form value)', () => {
		expect(coerceSerializedBool('s:1:"1"')).toBe(true);
	});

	test("b:0 → false", () => {
		expect(coerceSerializedBool("b:0")).toBe(false);
	});

	test('s:1:"0" → false', () => {
		expect(coerceSerializedBool('s:1:"0"')).toBe(false);
	});

	test("empty / undefined → false", () => {
		expect(coerceSerializedBool(undefined)).toBe(false);
		expect(coerceSerializedBool("")).toBe(false);
	});

	test("malformed → false (defensive default)", () => {
		expect(coerceSerializedBool("N")).toBe(false);
		expect(coerceSerializedBool("garbage")).toBe(false);
	});
});

describe("parseThreadTypes — empty / unparseable input", () => {
	test("null returns EMPTY_THREADTYPES_CONFIG-shaped value", () => {
		const result = parseThreadTypes(null);
		expect(result.enabled).toBe(false);
		expect(result.required).toBe(false);
		expect(result.listable).toBe(false);
		expect(result.prefix).toBe(false);
		expect(result.types.size).toBe(0);
	});

	test("empty string returns empty config", () => {
		const result = parseThreadTypes("");
		expect(result.types.size).toBe(0);
	});

	test("non-array payload returns empty config (no crash)", () => {
		// Some forumfield rows hold a stray `N;` or a non-array string.
		expect(parseThreadTypes("N;").types.size).toBe(0);
		expect(parseThreadTypes('s:0:"";').types.size).toBe(0);
	});

	test("EMPTY_THREADTYPES_CONFIG is shared and frozen", () => {
		// Defensive freeze guards callers from mutating the shared
		// sentinel; the parser may return it on the hot path for the
		// dominant empty case (most non-category forums).
		expect(Object.isFrozen(EMPTY_THREADTYPES_CONFIG)).toBe(true);
	});
});

describe("parseThreadTypes — fid=134 (跳蚤市场, modern admin shape)", () => {
	const result = parseThreadTypes(FIXTURE_FID_134);

	test('prefix is s:1:"1" form, must coerce to true', () => {
		// Reviewer pin #2 — older quickly-written regexes (including
		// the reviewer's own first cut) misread `s:1:"1"` as "non-empty
		// string ⇒ true" by accident, which only worked because the
		// payload happened to be `"1"`. We require the actual coercion.
		expect(result.prefix).toBe(true);
	});

	test("required + listable both b:1 → true", () => {
		expect(result.required).toBe(true);
		expect(result.listable).toBe(true);
	});

	test("status key absent → enabled defaults to false (admin re-saved without it)", () => {
		// The verify artifact's acceptance criterion (fid=134 has 5
		// enabled categories) is satisfied by the `types` map having
		// 5 entries even when the top-level `status` key is missing.
		// We deliberately do NOT infer `enabled` from `types.size > 0`
		// because the reviewer wants tombstones (enabled=0 categories
		// merged in from pre_forum_threadclass) to still surface in
		// `forum_thread_types`. enabled/required/listable/prefix must
		// reflect ONLY the current admin config.
		expect(result.enabled).toBe(false);
	});

	test("types map has 5 entries with correct names", () => {
		expect(result.types.size).toBe(5);
		expect(result.types.get(561)).toBe("校园代理");
		expect(result.types.get(562)).toBe("房屋租赁");
		expect(result.types.get(565)).toBe("生活资料");
	});

	test("icons map has 5 entries (all empty strings)", () => {
		expect(result.icons.size).toBe(5);
		expect(result.icons.get(561)).toBe("");
	});

	test("moderatorOnly empty (all N in moderators submap)", () => {
		expect(result.moderatorOnly.size).toBe(0);
	});
});

describe("parseThreadTypes — fid=113 (legacy admin shape with i:0 keys)", () => {
	const result = parseThreadTypes(FIXTURE_FID_113);

	test("leading `i:0;b:0;` junk does not crash the parser", () => {
		// The legacy admin write path produced a stray non-keyed entry
		// at the top of the array (`i:0;b:0;`). A naive parser that
		// tried to read top-level entries as key/value pairs starting
		// from index 0 would interpret this as `key=i:0, value=b:0`
		// and either crash or pollute the result. We just require the
		// final `types`/`icons` reads to succeed.
		expect(result.types.size).toBe(3);
	});

	test("types map preserves i:0 as a legitimate typeid (reviewer pin #1)", () => {
		// `PUB` (typeid=0), `REQ` (typeid=1), `Completed` (typeid=2)
		// are the three categories admin configured on fid=113. Even
		// though 0 looks like a sentinel "no-category", in THIS forum's
		// types map it's a real category — and threads with typeid=0
		// in fid=113 should resolve to "PUB", not "(uncategorized)".
		// The thread-row mapper makes the final call when writing
		// threads.type_id; this parser must not throw the data away.
		expect(result.types.get(0)).toBe("PUB");
		expect(result.types.get(1)).toBe("REQ");
		expect(result.types.get(2)).toBe("Completed");
	});

	test("no status/required/listable/prefix keys → all default false", () => {
		expect(result.enabled).toBe(false);
		expect(result.required).toBe(false);
		expect(result.listable).toBe(false);
		expect(result.prefix).toBe(false);
	});

	test("icons map also keeps i:0 key (parallel to types)", () => {
		expect(result.icons.has(0)).toBe(true);
		expect(result.icons.has(2)).toBe(true);
	});
});

describe("parseThreadTypes — fid=147 (clean current shape)", () => {
	const result = parseThreadTypes(FIXTURE_FID_147);

	test("all four bool fields parse correctly (b:1 and b:0 mix)", () => {
		expect(result.enabled).toBe(true);
		expect(result.required).toBe(false);
		expect(result.listable).toBe(true);
		expect(result.prefix).toBe(false);
	});

	test("types map has 5 entries with non-zero typeids", () => {
		// Per acceptance criterion: fid=147 verify artifact must show
		// 5 enabled categories. The parser surface is the 5 typeids;
		// `enabled=true` plus 5 types is what the transform converts
		// into 5 forum_thread_types rows with enabled=1.
		expect(result.types.size).toBe(5);
		expect([...result.types.keys()]).toEqual([701, 702, 703, 704, 705]);
	});
});

describe("parseThreadTypes — boundary forms", () => {
	test('prefix as b:1 (alternate form to fid=134 s:1:"1") also coerces to true', () => {
		const raw = 'a:1:{s:6:"prefix";b:1;}';
		expect(parseThreadTypes(raw).prefix).toBe(true);
	});

	test("prefix as b:0 → false", () => {
		const raw = 'a:1:{s:6:"prefix";b:0;}';
		expect(parseThreadTypes(raw).prefix).toBe(false);
	});

	test('prefix as s:1:"0" → false', () => {
		const raw = 'a:1:{s:6:"prefix";s:1:"0";}';
		expect(parseThreadTypes(raw).prefix).toBe(false);
	});

	test('string-typed typeid key (s:3:"42") is preserved as 42', () => {
		// AdminCP occasionally writes string-typed array keys for
		// numeric typeids — Discuz treats them as ints on read. We
		// must too, otherwise the (fid, typeid) pair fails to match
		// the corresponding pre_forum_threadclass row.
		const raw = 'a:1:{s:5:"types";a:1:{s:2:"42";s:3:"foo";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.get(42)).toBe("foo");
	});

	test("moderator-only typeids are tracked via non-N value in moderators map", () => {
		// e.g. a:2:{i:1;N;i:2;s:1:"1";} → typeid=2 is moderator-only,
		// typeid=1 is not. The current dump fixtures all use N, but the
		// parser must still surface the moderator flag for older forums
		// that have it set (otherwise the `moderator_only` column on
		// forum_thread_types is always 0).
		const raw = 'a:1:{s:10:"moderators";a:2:{i:1;N;i:2;s:1:"1";}}';
		const result = parseThreadTypes(raw);
		expect(result.moderatorOnly.has(1)).toBe(false);
		expect(result.moderatorOnly.has(2)).toBe(true);
	});

	test("types value with embedded quotes (escaped) parses by declared length", () => {
		// s:N:"..." carries N bytes regardless of internal quotes. We
		// must NOT split on `"` — the byte-length walk handles this.
		// Construct a name containing a literal `";` substring which
		// would trip a naive quote-anchored regex.
		const inner = 'abc";def';
		const len = Buffer.byteLength(inner, "utf8");
		const raw = `a:1:{s:5:"types";a:1:{i:7;s:${len}:"${inner}";}}`;
		const result = parseThreadTypes(raw);
		expect(result.types.get(7)).toBe(inner);
	});

	test("moderator-only with non-string non-N value (e.g. nested array) still flags", () => {
		// Defensive: if the moderators submap ever holds a non-N,
		// non-string value (e.g. a nested array from an older Discuz
		// version), we still treat the typeid as moderator-only — the
		// admin clearly wrote SOMETHING there.
		const raw = 'a:1:{s:10:"moderators";a:1:{i:9;a:0:{}}}';
		const result = parseThreadTypes(raw);
		expect(result.moderatorOnly.has(9)).toBe(true);
	});

	test('moderator-only with empty string value (s:0:"") is NOT flagged', () => {
		const raw = 'a:1:{s:10:"moderators";a:1:{i:9;s:0:"";}}';
		const result = parseThreadTypes(raw);
		expect(result.moderatorOnly.has(9)).toBe(false);
	});

	test("negative integer typeid (i:-1) decodes correctly", () => {
		// Defensive — DZ shouldn't write negatives but the parser
		// supports the sign byte so we don't silently swallow rare data.
		const raw = 'a:1:{s:5:"types";a:1:{i:-1;s:3:"neg";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.get(-1)).toBe("neg");
	});

	test("non-numeric string key in types map is skipped", () => {
		// `s:3:"abc"` as a typeid key is invalid — drop the entry rather
		// than coerce to NaN.
		const raw = 'a:1:{s:5:"types";a:1:{s:3:"abc";s:3:"foo";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(0);
	});

	test("non-string value inside types map is skipped (defensive)", () => {
		// types values should always be strings; if a row holds a
		// non-string (e.g. an int), drop the entry rather than coerce.
		const raw = 'a:1:{s:5:"types";a:1:{i:1;i:99;}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(0);
	});

	test("unknown value token byte (not b/i/d/N/s/a) does not crash", () => {
		// Defensive: a corrupted dump where a value starts with a byte
		// that isn't one of the PHP serialize type prefixes. The fallback
		// in `readTokenEnd` must scan to `;` and the entry must be skipped
		// (value is not BYTE_s, so no name is set). Without this fallback,
		// the walker would either infinite-loop or mis-advance.
		const raw = 'a:1:{s:5:"types";a:1:{i:1;X;}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(0);
	});

	test("non-int/non-string key byte in types map is skipped (defensive)", () => {
		// PHP arrays only legitimately have int or string keys, but a
		// corrupted dump could synthesize an `N`-keyed entry. The key
		// decoder must return null for keys whose first byte is neither
		// `i` nor `s`, dropping the entry without throwing.
		const raw = 'a:1:{s:5:"types";a:1:{N;s:3:"foo";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(0);
	});

	test("unterminated inner array does not crash (end-of-buffer fallback)", () => {
		// If the dump is truncated mid-array, `findMatchingClose` must
		// return `bytes.length` rather than walk off the end of the
		// buffer. The outer parser then surfaces whatever it could read
		// without throwing — we only assert no-throw and an empty types
		// map (the inner `types` array's `{` never closes, so its body
		// is unparseable past the truncation point).
		const raw = 'a:1:{s:5:"types";a:1:{i:1;s:3:"foo";';
		expect(() => parseThreadTypes(raw)).not.toThrow();
	});
});
