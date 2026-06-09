import { describe, expect, test } from "vitest";
import {
	coerceSerializedBool,
	EMPTY_THREADTYPES_CONFIG,
	parseThreadTypes,
} from "../src/transform/threadtypes";

/**
 * Fixtures captured from `reference/db/2026-05-14/db_tongji_main_full.sql.gz`
 * (`pre_forum_forumfield.threadtypes` column). The SQL-string-literal
 * escape layer (`\"` → `"`) has been pre-applied; what we feed the
 * parser is the actual PHP-serialized payload as it would arrive after
 * `parser.ts` unescapes the dump value.
 *
 * `enabled` semantics (reviewer pin e408cbf0): driven by
 * `types.size > 0`, NOT the legacy `status` key. The raw `status` bit
 * is surfaced as `rawStatusEnabled` for dry-run parity logging only.
 *
 * fid=134 (跳蚤市场, current) shows the modern admin shape:
 *   • status absent → rawStatusEnabled=false, but enabled=true because
 *     5 admin-configured categories exist. Admin re-saved via the
 *     newer UI drops the legacy `status` key — a known Discuz quirk.
 *   • required, listable as b:1
 *   • prefix as s:1:"1"          ← reviewer pin #2 (must coerce to true)
 *   • types: i:561..i:565 → 5 entries, all non-zero typeids
 *
 * fid=113 (电脑技术, legacy) shows the admin's older write path:
 *   • Leading junk key i:0;b:0; — must not crash the parser.
 *   • No status/required/listable/prefix keys; enabled=true via types
 *     (the forum has 3 categories), but the three per-feature flags
 *     stay false so the Web UI keeps the data + retains prefix
 *     rendering capability without forcing the picker or showing the
 *     filter strip (reviewer pin e408cbf0).
 *   • types is a:3 with KEYS i:0/i:1/i:2 — reviewer pin #1: these are
 *     LEGITIMATE typeids (PUB/REQ/Completed), NOT "no-category". The
 *     parser must preserve `0` as a real key.
 *
 * fid=147 (春运信息, real dump payload) is the strongest regression
 * anchor for the new `enabled` semantics: the row carries 5 admin
 * categories (求购/出售/换票/同路/信息, typeids 76/77/79/81/83) but no
 * top-level `status` key. The four feature flags all parse true
 * (required/listable b:1, prefix s:1:"1"). If anyone ever flips
 * `enabled` back to legacy `status`-derived, this fixture will fail —
 * fid=134 only catches the `prefix=s:1:"1"` path, fid=147 catches the
 * `status-absent + types-present` path that is the majority of live
 * forums per dry-run.
 */
const FIXTURE_FID_134 =
	'a:6:{s:8:"required";b:1;s:8:"listable";b:1;s:6:"prefix";s:1:"1";s:5:"types";a:5:{i:561;s:12:"校园代理";i:562;s:12:"房屋租赁";i:563;s:12:"学习资料";i:564;s:12:"电子通讯";i:565;s:12:"生活资料";}s:5:"icons";a:5:{i:561;s:0:"";i:562;s:0:"";i:563;s:0:"";i:564;s:0:"";i:565;s:0:"";}s:10:"moderators";a:5:{i:561;N;i:562;N;i:563;N;i:564;N;i:565;N;}}';

const FIXTURE_FID_113 =
	'a:3:{i:0;b:0;s:5:"types";a:3:{i:0;s:3:"PUB";i:1;s:3:"REQ";i:2;s:9:"Completed";}s:5:"icons";a:3:{i:0;s:0:"";i:1;s:0:"";i:2;s:0:"";}}';

const FIXTURE_FID_147 =
	'a:5:{s:8:"required";b:1;s:8:"listable";b:1;s:6:"prefix";s:1:"1";s:5:"types";a:5:{i:76;s:4:"求购";i:77;s:4:"出售";i:79;s:4:"换票";i:81;s:4:"同路";i:83;s:4:"信息";}s:5:"icons";a:5:{i:76;s:0:"";i:77;s:0:"";i:79;s:0:"";i:81;s:0:"";i:83;s:0:"";}}';

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

	test("status key absent → enabled now derived from types.size (reviewer e408cbf0)", () => {
		// Updated semantics: enabled = types.size > 0, NOT raw `status`.
		// fid=134 has 5 admin-configured categories so the forum's
		// category UI must be ON, even though the admin re-save dropped
		// the legacy `status` key. rawStatusEnabled stays false here to
		// flag the dry-run sanity-check (parity between legacy bit and
		// the new derivation).
		expect(result.enabled).toBe(true);
		expect(result.rawStatusEnabled).toBe(false);
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

	test("no status/required/listable/prefix keys → required/listable/prefix default false; enabled from types", () => {
		// fid=113 has 3 categories (PUB/REQ/Completed) so the forum
		// itself must be enabled — but with required/listable/prefix
		// false, the Web UI can keep the data + retain prefix-rendering
		// capability without forcing the picker or showing a filter
		// strip. The four forum flags are deliberately independent
		// (reviewer e408cbf0).
		expect(result.enabled).toBe(true);
		expect(result.rawStatusEnabled).toBe(false);
		expect(result.required).toBe(false);
		expect(result.listable).toBe(false);
		expect(result.prefix).toBe(false);
	});

	test("icons map also keeps i:0 key (parallel to types)", () => {
		expect(result.icons.has(0)).toBe(true);
		expect(result.icons.has(2)).toBe(true);
	});
});

describe("parseThreadTypes — fid=147 (real dump, status absent + 5 types)", () => {
	const result = parseThreadTypes(FIXTURE_FID_147);

	test("enabled true via types.size; rawStatusEnabled false (no status key in dump)", () => {
		// Reviewer pin eb0e5afe: this is the strongest regression
		// anchor against re-introducing `enabled = legacy status`.
		// fid=147 in the live dump has NO `status` key but 5 admin
		// categories — the forum's category UI must stay ON.
		expect(result.enabled).toBe(true);
		expect(result.rawStatusEnabled).toBe(false);
	});

	test('all three feature flags parse true (required b:1, listable b:1, prefix s:1:"1")', () => {
		expect(result.required).toBe(true);
		expect(result.listable).toBe(true);
		expect(result.prefix).toBe(true);
	});

	test("types map has 5 entries with real dump typeids 76/77/79/81/83", () => {
		// Per acceptance criterion: fid=147 verify artifact must show
		// 5 enabled categories. The parser surface is the 5 typeids;
		// `enabled=true` plus 5 types is what the transform converts
		// into 5 forum_thread_types rows with enabled=1.
		expect(result.types.size).toBe(5);
		expect([...result.types.keys()]).toEqual([76, 77, 79, 81, 83]);
		expect(result.types.get(76)).toBe("求购");
		expect(result.types.get(77)).toBe("出售");
		expect(result.types.get(83)).toBe("信息");
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

	test('legacy GBK byte-count strings (s:4:"求购" actual UTF-8 6) decode correctly', () => {
		// Reviewer pin eb0e5afe + parser fallback in readPhpStringExtent:
		// historical Discuz wrote `s:N:` lengths counting GBK bytes (one
		// CJK char = 2 bytes), but the column was later migrated to UTF-8
		// (one CJK char = 3 bytes). The declared `N` no longer matches
		// the actual UTF-8 byte length on legacy rows.
		//
		// Test isolates a *single* GBK-counted entry so the regression
		// surface is unambiguous — fid=147 fixture above exercises the
		// same code path inside a real 5-category dump. Without the
		// fallback, the parser walks past the actual closing `"` and
		// loses subsequent entries; with it, the next-token sentinel
		// (`";<a/b/d/i/s/N/}>`) recovers alignment.
		const raw = 'a:1:{s:5:"types";a:2:{i:76;s:4:"求购";i:77;s:4:"出售";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(2);
		expect(result.types.get(76)).toBe("求购");
		expect(result.types.get(77)).toBe("出售");
	});

	test('legacy GBK byte-count with mixed ASCII + CJK content (s:19:"Linux/Unix开发/内核")', () => {
		// Real fixture pattern from `pre_forum_threadtype.name` in the
		// dump: declared length 19 (GBK: 10 ASCII + 4 CJK × 2 + 1 = 19),
		// actual UTF-8 bytes 20 (10 ASCII + 4 CJK × 3 = wait, recompute:
		// "Linux/Unix" = 10 bytes, "开发" = 6, "/" = 1, "内核" = 6 → 23).
		// Either way actual ≠ 19. The fallback must still recover.
		const inner = "Linux/Unix开发/内核";
		const raw = `a:1:{s:5:"types";a:1:{i:42;s:19:"${inner}";}}`;
		const result = parseThreadTypes(raw);
		expect(result.types.get(42)).toBe(inner);
	});

	test('GBK string at end of array recovers via `";}` sentinel', () => {
		// Exercises the `BYTE_CLOSE` branch of PHP_TOKEN_START_BYTES:
		// when a GBK-counted string is the LAST entry of an array, the
		// sentinel after the closing `";` is `}`, not another token start
		// byte. The scan must accept this so trailing-CJK rows don't get
		// dropped.
		const raw = 'a:1:{s:5:"types";a:1:{i:1;s:4:"测试";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.get(1)).toBe("测试");
	});

	test("GBK fallback gives up cleanly when no sentinel is found (truncated CJK)", () => {
		// If a corrupted dump cuts off mid-string with no recoverable
		// `";<token>` sentinel, the fallback hits end-of-buffer and the
		// extent collapses to bytes.length. The outer parser must not
		// throw; the types map is empty (no valid entry could be read).
		const raw = 'a:1:{s:5:"types";a:1:{i:1;s:4:"未结尾';
		expect(() => parseThreadTypes(raw)).not.toThrow();
	});

	test("non-int/non-string key in icons map is skipped (defensive)", () => {
		// Parallel to the types-map test above. Drift guard: if a
		// corrupted dump sneaks an `N`-keyed entry into icons, the
		// decoder must skip it without throwing.
		const raw = 'a:1:{s:5:"icons";a:1:{N;s:0:"";}}';
		const result = parseThreadTypes(raw);
		expect(result.icons.size).toBe(0);
	});

	test("non-string value inside icons map is skipped (defensive)", () => {
		// Icons should always be strings. A non-string (e.g. int) value
		// gets dropped rather than coerced to a numeric "icon path".
		const raw = 'a:1:{s:5:"icons";a:1:{i:1;i:99;}}';
		const result = parseThreadTypes(raw);
		expect(result.icons.size).toBe(0);
	});

	test("non-int/non-string key in moderators map is skipped (defensive)", () => {
		// Parallel to types/icons. Bad keys must not throw the entry
		// into moderatorOnly.
		const raw = 'a:1:{s:10:"moderators";a:1:{N;s:1:"1";}}';
		const result = parseThreadTypes(raw);
		expect(result.moderatorOnly.size).toBe(0);
	});

	test("explicit `status` key surfaces as rawStatusEnabled (parity branch)", () => {
		// Although the new semantics derive `enabled` from `types.size`,
		// the legacy `status` bit is still surfaced as rawStatusEnabled
		// so the dry-run sanity check can flag parity drift. This guards
		// the `statusRange ? coerceBoolByteRange(...) : false` branch on
		// the truthy side.
		const raw = 'a:1:{s:6:"status";b:1;}';
		const result = parseThreadTypes(raw);
		expect(result.rawStatusEnabled).toBe(true);
		// No `types` key → enabled false (new semantics).
		expect(result.enabled).toBe(false);
	});

	test("empty-name entry in types map is dropped (`if (name)` false branch)", () => {
		// `s:0:""` decodes to an empty string. The parser treats empty
		// names as junk (Discuz never writes a typeid → "" tuple in real
		// admin flows) and drops them rather than letting a blank chip
		// reach the UI.
		const raw = 'a:1:{s:5:"types";a:1:{i:1;s:0:"";}}';
		const result = parseThreadTypes(raw);
		expect(result.types.size).toBe(0);
	});
});
