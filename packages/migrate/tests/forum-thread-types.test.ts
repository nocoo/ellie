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
 * tombstones).
 *
 * Reviewer policies under verification (msg 73d85116, eb0e5afe):
 *   • Enabled set = `forumfield.types` (admin's current view).
 *   • For typeids ∈ enabled-set: name + display_order from forumfield.
 *     icon/moderator fall back to threadclass when forumfield empty.
 *   • For typeids ∈ threadclass but ∉ forumfield.types: tombstone row
 *     (enabled=0) using threadclass.name etc.
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
	test("emits one row per forumfield.types entry, all enabled=1", () => {
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
		const rows = buildForumThreadTypeRows(new Map([[147, cfg]]), new Map());
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.id)).toEqual([76, 77, 79]);
		expect(rows.every((r) => r.forum_id === 147 && r.enabled === 1)).toBe(true);
		expect(rows.map((r) => r.display_order)).toEqual([0, 1, 2]);
		expect(rows.find((r) => r.id === 77)?.icon).toBe("icon-out.png");
	});

	test("preserves forumfield.types iteration order as display_order", () => {
		const cfg = makeConfig({
			types: [
				[100, "C"],
				[5, "B"],
				[55, "A"],
			],
		});
		const rows = buildForumThreadTypeRows(new Map([[10, cfg]]), new Map());
		expect(rows.map((r) => [r.id, r.display_order])).toEqual([
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
		const rows = buildForumThreadTypeRows(new Map([[5, cfg]]), new Map([[5, classRows]]));
		expect(rows).toHaveLength(2);

		// Enabled row uses forumfield.name (NOT the stale threadclass name).
		const enabled = rows.find((r) => r.id === 10);
		expect(enabled).toMatchObject({
			id: 10,
			forum_id: 5,
			name: "Current",
			enabled: 1,
			display_order: 0,
		});

		// Tombstone row uses threadclass values, enabled=0.
		const tombstone = rows.find((r) => r.id === 11);
		expect(tombstone).toMatchObject({
			id: 11,
			forum_id: 5,
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
			// No icon for typeid=20 in forumfield.icons.
			// No moderatorOnly entry either.
		});
		const classRows = [
			makeClassRow({ typeid: 20, fid: 9, name: "Stale", icon: "fallback.png", moderators: 1 }),
		];
		const rows = buildForumThreadTypeRows(new Map([[9, cfg]]), new Map([[9, classRows]]));
		expect(rows[0]).toMatchObject({
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
		const rows = buildForumThreadTypeRows(new Map([[9, cfg]]), new Map([[9, classRows]]));
		expect(rows[0]?.icon).toBe("from-field.png");
	});

	test("emits only tombstones when forumfield.types is empty/unconfigured", () => {
		const classRows = [
			makeClassRow({ typeid: 50, fid: 1, name: "Old1" }),
			makeClassRow({ typeid: 51, fid: 1, name: "Old2" }),
		];
		const rows = buildForumThreadTypeRows(new Map(), new Map([[1, classRows]]));
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.enabled === 0)).toBe(true);
	});
});

describe("buildForumThreadTypeRows — multi-forum determinism", () => {
	test("forums are emitted in numeric ascending fid order", () => {
		const cfgA = makeConfig({ types: [[1, "A"]] });
		const cfgB = makeConfig({ types: [[2, "B"]] });
		const rows = buildForumThreadTypeRows(
			new Map([
				[200, cfgB],
				[100, cfgA],
			]),
			new Map(),
		);
		expect(rows.map((r) => r.forum_id)).toEqual([100, 200]);
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
		// Empty-name entry should not enter the resolution map.
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
