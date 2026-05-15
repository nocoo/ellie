import { describe, expect, test } from "vitest";
import type { ThreadClassRow } from "../src/extract/extractors";
import {
	buildForumThreadTypeNameMap,
	buildForumThreadTypeRows,
} from "../src/transform/forum-thread-types";
import { EMPTY_THREADTYPES_CONFIG, type ThreadTypesConfig } from "../src/transform/threadtypes";

/**
 * Tests for the forum_thread_types transform — the merge layer that
 * combines `pre_forum_forumfield.threadtypes` (admin's enabled-set) with
 * `pre_forum_threadclass` (per-row table that includes legacy
 * tombstones), plus the synthetic-id mint introduced by 0039.
 *
 * Reviewer policies under verification (msgs 73d85116, eb0e5afe, c5d10236,
 * 3d056b39):
 *   • Enabled set = `forumfield.types` (admin's current view).
 *   • For typeids ∈ enabled-set: name + display_order from forumfield.
 *     icon/moderator fall back to threadclass when forumfield empty.
 *   • For typeids ∈ threadclass but ∉ forumfield.types: tombstone row
 *     (enabled=0) using threadclass.name etc.
 *   • source_typeid=0 is NEVER emitted as an enabled row; recorded in
 *     `zeroTypeidDefinitions` for admin/debug.
 *   • Synthetic id minted deterministically by (forum_id ASC,
 *     source_typeid ASC), starting at 1.
 *   • Output rows include source_typeid alongside the synthetic id.
 */

function makeConfig(opts: {
	enabled?: boolean;
	required?: boolean;
	listable?: boolean;
	prefix?: boolean;
	types?: Array<[number, string]>;
	icons?: Array<[number, string]>;
	moderatorOnly?: number[];
}): ThreadTypesConfig {
	return {
		...EMPTY_THREADTYPES_CONFIG,
		enabled: !!(opts.types && opts.types.length > 0),
		required: !!opts.required,
		listable: !!opts.listable,
		prefix: !!opts.prefix,
		rawStatusEnabled: !!opts.enabled,
		types: new Map(opts.types ?? []),
		icons: new Map(opts.icons ?? []),
		moderatorOnly: new Set(opts.moderatorOnly ?? []),
	};
}

function makeClassRow(overrides: Partial<ThreadClassRow>): ThreadClassRow {
	return {
		typeid: 0,
		fid: 0,
		name: "",
		displayorder: 0,
		icon: "",
		moderators: 0,
		...overrides,
	};
}

describe("buildForumThreadTypeRows — enabled-set only (no threadclass)", () => {
	test("emits one row per forumfield.types entry, all enabled=1, with synthetic ids 1..N", () => {
		const cfg = makeConfig({
			required: true,
			listable: true,
			types: [
				[76, "求购"],
				[77, "出售"],
				[79, "换票"],
			],
			icons: [[77, "icon-out.png"]],
		});
		const result = buildForumThreadTypeRows(new Map([[147, cfg]]), new Map());
		expect(result.rows).toHaveLength(3);
		// Synthetic ids start at 1 and increment in mint order
		// (forumfield.types iteration order within the forum).
		expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3]);
		// source_typeid is the original Discuz typeid.
		expect(result.rows.map((r) => r.source_typeid)).toEqual([76, 77, 79]);
		expect(result.rows.every((r) => r.forum_id === 147 && r.enabled === 1)).toBe(true);
		expect(result.rows.map((r) => r.display_order)).toEqual([0, 1, 2]);
		expect(result.rows.find((r) => r.source_typeid === 77)?.icon).toBe("icon-out.png");

		// syntheticIdMap mirrors the assignments.
		expect(result.syntheticIdMap.get(147)?.get(76)).toBe(1);
		expect(result.syntheticIdMap.get(147)?.get(77)).toBe(2);
		expect(result.syntheticIdMap.get(147)?.get(79)).toBe(3);
	});

	test("preserves forumfield.types iteration order as display_order (independent of source typeid)", () => {
		const cfg = makeConfig({
			types: [
				[100, "C"],
				[5, "B"],
				[55, "A"],
			],
		});
		const result = buildForumThreadTypeRows(new Map([[10, cfg]]), new Map());
		expect(result.rows.map((r) => [r.source_typeid, r.display_order])).toEqual([
			[100, 0],
			[5, 1],
			[55, 2],
		]);
	});
});

describe("buildForumThreadTypeRows — threadclass merge", () => {
	test("emits tombstone rows for typeids ∈ threadclass but ∉ forumfield.types", () => {
		const cfg = makeConfig({
			types: [[10, "Current"]],
		});
		const classRows = [
			makeClassRow({ typeid: 10, fid: 5, name: "Current-Stale", displayorder: 99 }),
			makeClassRow({
				typeid: 11,
				fid: 5,
				name: "Tombstone",
				displayorder: 7,
				icon: "tomb.png",
				moderators: 1,
			}),
		];
		const result = buildForumThreadTypeRows(new Map([[5, cfg]]), new Map([[5, classRows]]));
		expect(result.rows).toHaveLength(2);

		// Enabled row uses forumfield.name (NOT the stale threadclass name);
		// gets synthetic id 1.
		const enabled = result.rows.find((r) => r.source_typeid === 10);
		expect(enabled).toMatchObject({
			id: 1,
			forum_id: 5,
			source_typeid: 10,
			name: "Current",
			enabled: 1,
			display_order: 0,
		});

		// Tombstone row uses threadclass values, enabled=0; gets next
		// synthetic id 2.
		const tombstone = result.rows.find((r) => r.source_typeid === 11);
		expect(tombstone).toMatchObject({
			id: 2,
			forum_id: 5,
			source_typeid: 11,
			name: "Tombstone",
			display_order: 7,
			icon: "tomb.png",
			enabled: 0,
			moderator_only: 1,
		});
	});

	test("threadclass icon/moderators fall back when forumfield has no value", () => {
		const cfg = makeConfig({
			types: [[20, "Type"]],
		});
		const classRows = [
			makeClassRow({ typeid: 20, fid: 9, name: "Stale", icon: "fallback.png", moderators: 1 }),
		];
		const result = buildForumThreadTypeRows(new Map([[9, cfg]]), new Map([[9, classRows]]));
		expect(result.rows[0]).toMatchObject({
			icon: "fallback.png",
			moderator_only: 1,
		});
	});

	test("forumfield icon wins over threadclass icon when both present", () => {
		const cfg = makeConfig({
			types: [[30, "Type"]],
			icons: [[30, "from-field.png"]],
		});
		const classRows = [makeClassRow({ typeid: 30, fid: 9, name: "Stale", icon: "from-class.png" })];
		const result = buildForumThreadTypeRows(new Map([[9, cfg]]), new Map([[9, classRows]]));
		expect(result.rows[0]?.icon).toBe("from-field.png");
	});

	test("emits only tombstones when forumfield.types is empty/unconfigured", () => {
		const classRows = [
			makeClassRow({ typeid: 50, fid: 1, name: "Old1" }),
			makeClassRow({ typeid: 51, fid: 1, name: "Old2" }),
		];
		const result = buildForumThreadTypeRows(new Map(), new Map([[1, classRows]]));
		expect(result.rows).toHaveLength(2);
		expect(result.rows.every((r) => r.enabled === 0)).toBe(true);
		// Tombstones still get synthetic ids in source_typeid ASC order.
		expect(result.rows.map((r) => [r.id, r.source_typeid])).toEqual([
			[1, 50],
			[2, 51],
		]);
	});
});

describe("buildForumThreadTypeRows — multi-forum determinism", () => {
	test("forums are emitted in numeric ascending fid order, synthetic ids continuous across forums", () => {
		const cfgA = makeConfig({ types: [[1, "A"]] });
		const cfgB = makeConfig({ types: [[2, "B"]] });
		const result = buildForumThreadTypeRows(
			new Map([
				[200, cfgB],
				[100, cfgA],
			]),
			new Map(),
		);
		// fid=100 mints first → id=1; fid=200 next → id=2.
		expect(result.rows.map((r) => [r.forum_id, r.source_typeid, r.id])).toEqual([
			[100, 1, 1],
			[200, 2, 2],
		]);
	});

	test("two runs over the same input produce byte-identical rows (deterministic mint)", () => {
		// Reviewer pin 3d056b39 #4: deterministic ordering matters for
		// dry-run diff readability and CI replay tests.
		const cfg111 = makeConfig({ types: [[1, "A"]] });
		const cfg113 = makeConfig({
			types: [
				[1, "B"],
				[2, "C"],
			],
		});
		const inputs: [Map<number, ThreadTypesConfig>, Map<number, ThreadClassRow[]>] = [
			new Map([
				[111, cfg111],
				[113, cfg113],
			]),
			new Map(),
		];
		const r1 = buildForumThreadTypeRows(...inputs);
		const r2 = buildForumThreadTypeRows(...inputs);
		expect(JSON.stringify(r1.rows)).toBe(JSON.stringify(r2.rows));
		expect(JSON.stringify(r1.sourceTypeidGlobalDuplicates)).toBe(
			JSON.stringify(r2.sourceTypeidGlobalDuplicates),
		);
	});
});

describe("buildForumThreadTypeRows — source_typeid=0 handling (reviewer pin c5d10236)", () => {
	test("source_typeid=0 in forumfield.types is recorded but NOT emitted as enabled row", () => {
		// fid=113 PUB defines typeid=0 in admin; we must NOT promote that
		// to a synthetic row because thread.typeid=0 means "no category"
		// in Discuz's data model.
		const cfg = makeConfig({
			types: [
				[0, "PUB-zero"],
				[1, "Real"],
			],
		});
		const result = buildForumThreadTypeRows(new Map([[113, cfg]]), new Map());
		// Only typeid=1 becomes a row; typeid=0 is captured as a
		// zero-typeid definition.
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			id: 1,
			forum_id: 113,
			source_typeid: 1,
			name: "Real",
			enabled: 1,
		});
		expect(result.zeroTypeidDefinitions).toEqual([
			{ fid: 113, name: "PUB-zero", source: "forumfield" },
		]);
		// syntheticIdMap must NOT contain a 0 entry.
		expect(result.syntheticIdMap.get(113)?.get(0)).toBeUndefined();
	});

	test("source_typeid=0 in threadclass (without forumfield definition) is also skipped", () => {
		const classRows = [
			makeClassRow({ typeid: 0, fid: 113, name: "ClassPUB" }),
			makeClassRow({ typeid: 5, fid: 113, name: "Real" }),
		];
		const result = buildForumThreadTypeRows(new Map(), new Map([[113, classRows]]));
		expect(result.rows.map((r) => r.source_typeid)).toEqual([5]);
		expect(result.zeroTypeidDefinitions).toEqual([
			{ fid: 113, name: "ClassPUB", source: "threadclass" },
		]);
	});
});

describe("buildForumThreadTypeRows — globalCollisions diagnostics (reviewer pin 3d056b39 #4)", () => {
	test("sourceTypeidGlobalDuplicates lists typeids reused across multiple forums", () => {
		// This is the exact failure mode discovered on the 5-14 dump:
		// typeid=1 appears in fid=111 and fid=113.
		const cfg111 = makeConfig({ types: [[1, "Q"]] });
		const cfg113 = makeConfig({
			types: [
				[1, "A"],
				[2, "B"],
			],
		});
		const cfg134 = makeConfig({ types: [[2, "X"]] });
		const result = buildForumThreadTypeRows(
			new Map([
				[111, cfg111],
				[113, cfg113],
				[134, cfg134],
			]),
			new Map(),
		);
		expect(result.sourceTypeidGlobalDuplicates).toEqual([
			{ source_typeid: 1, forums: [111, 113] },
			{ source_typeid: 2, forums: [113, 134] },
		]);
	});

	test("typeids unique across forums are NOT listed as duplicates", () => {
		const cfgA = makeConfig({ types: [[100, "A"]] });
		const cfgB = makeConfig({ types: [[200, "B"]] });
		const result = buildForumThreadTypeRows(
			new Map([
				[10, cfgA],
				[20, cfgB],
			]),
			new Map(),
		);
		expect(result.sourceTypeidGlobalDuplicates).toEqual([]);
	});
});

describe("buildForumThreadTypeRows — perForumReconciliation (reviewer pin 3d056b39 #4)", () => {
	test("captures forumfield-only / threadclass-only / both intersection per forum", () => {
		const cfg = makeConfig({
			types: [
				[1, "Both"],
				[2, "FF-only"],
			],
		});
		const classRows = [
			makeClassRow({ typeid: 1, fid: 50, name: "Both-stale" }),
			makeClassRow({ typeid: 3, fid: 50, name: "TC-only" }),
		];
		const result = buildForumThreadTypeRows(new Map([[50, cfg]]), new Map([[50, classRows]]));
		expect(result.perForumReconciliation).toHaveLength(1);
		expect(result.perForumReconciliation[0]).toMatchObject({
			fid: 50,
			both: [1],
			forumfieldOnly: [2],
			threadclassOnly: [3],
			zeroIncluded: false,
			enabledRows: 2, // typeid 1 + 2 from forumfield
			tombstoneRows: 1, // typeid 3 from threadclass
		});
	});

	test("zeroIncluded flag set when typeid=0 appears on either side", () => {
		const cfg = makeConfig({ types: [[0, "Zero"]] });
		const result = buildForumThreadTypeRows(new Map([[113, cfg]]), new Map());
		expect(result.perForumReconciliation[0]?.zeroIncluded).toBe(true);
	});
});

describe("buildForumThreadTypeNameMap — name resolution", () => {
	test("forumfield.types names take precedence over threadclass names", () => {
		const cfg = makeConfig({ types: [[10, "Current"]] });
		const classRows = [
			makeClassRow({ typeid: 10, fid: 5, name: "Stale" }),
			makeClassRow({ typeid: 11, fid: 5, name: "TombName" }),
		];
		const m = buildForumThreadTypeNameMap(new Map([[5, cfg]]), new Map([[5, classRows]]));
		expect(m.get(5)?.get(10)).toBe("Current");
		expect(m.get(5)?.get(11)).toBe("TombName");
	});

	test("forums with no resolvable name map are absent from result", () => {
		const cfg: ThreadTypesConfig = makeConfig({ types: [[10, ""]] });
		const m = buildForumThreadTypeNameMap(new Map([[5, cfg]]), new Map());
		expect(m.has(5)).toBe(false);
	});

	test("union of fids is taken from both inputs", () => {
		const cfg = makeConfig({ types: [[1, "X"]] });
		const classRows = [makeClassRow({ typeid: 9, fid: 200, name: "Y" })];
		const m = buildForumThreadTypeNameMap(new Map([[100, cfg]]), new Map([[200, classRows]]));
		expect(m.has(100)).toBe(true);
		expect(m.has(200)).toBe(true);
	});
});
