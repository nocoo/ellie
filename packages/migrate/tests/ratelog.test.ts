/**
 * Unit tests for the ratelog ETL transforms.
 *
 * Focus on the pure functions (normalize / dedupe / mapping / SQL chunk /
 * CSV / SUMMARY). End-to-end CLI flow is exercised by Phase 5 dry-run.
 */

import { RatingDimension } from "@ellie/types";
import { describe, expect, it } from "vitest";

import {
	type AcceptedRow,
	type MergedRatelogRow,
	type NormalizedRatelogRow,
	type RatelogRawRow,
	applyMapping,
	buildInsertChunk,
	chunkRows,
	extcreditsToDimension,
	mergeDuplicates,
	normalizeRatelogRow,
	renderDroppedCsv,
	renderMergedCsv,
	renderSummaryMarkdown,
	sqlString,
} from "../src/transform/ratelog";

const REASON_MAX = 40;

function rawRow(overrides: Partial<RatelogRawRow> = {}): RatelogRawRow {
	return {
		pid: 100,
		uid: 50,
		username: "alice",
		extcredits: 1,
		dateline: 1_700_000_000,
		score: 5,
		reason: "thanks",
		...overrides,
	};
}

describe("extcreditsToDimension", () => {
	it("maps 1 → credits, 2 → coins", () => {
		expect(extcreditsToDimension(1)).toBe(RatingDimension.Credits);
		expect(extcreditsToDimension(2)).toBe(RatingDimension.Coins);
	});

	it("returns null for any other slot", () => {
		expect(extcreditsToDimension(0)).toBeNull();
		expect(extcreditsToDimension(3)).toBeNull();
		expect(extcreditsToDimension(8)).toBeNull();
	});
});

describe("normalizeRatelogRow", () => {
	it("returns null for extcredits outside {1,2}", () => {
		expect(normalizeRatelogRow(rawRow({ extcredits: 3 }), REASON_MAX)).toBeNull();
		expect(normalizeRatelogRow(rawRow({ extcredits: 0 }), REASON_MAX)).toBeNull();
	});

	it("returns null when uid or pid is 0", () => {
		expect(normalizeRatelogRow(rawRow({ uid: 0 }), REASON_MAX)).toBeNull();
		expect(normalizeRatelogRow(rawRow({ pid: 0 }), REASON_MAX)).toBeNull();
	});

	it("collapses whitespace and caps reason length", () => {
		const longReason = "a".repeat(100);
		const row = normalizeRatelogRow(
			rawRow({ reason: `   multi\n\tline\r\nreason ${longReason}` }),
			REASON_MAX,
		);
		expect(row).not.toBeNull();
		expect(row?.reason.length).toBeLessThanOrEqual(REASON_MAX);
		expect(row?.reason.includes("\n")).toBe(false);
		expect(row?.reason.includes("\t")).toBe(false);
		expect(row?.reason.startsWith("multi")).toBe(true);
	});

	it("preserves dimension mapping", () => {
		expect(normalizeRatelogRow(rawRow({ extcredits: 1 }), REASON_MAX)?.dimension).toBe(
			RatingDimension.Credits,
		);
		expect(normalizeRatelogRow(rawRow({ extcredits: 2 }), REASON_MAX)?.dimension).toBe(
			RatingDimension.Coins,
		);
	});

	it("preserves negative scores", () => {
		const norm = normalizeRatelogRow(rawRow({ score: -7 }), REASON_MAX);
		expect(norm?.score).toBe(-7);
	});
});

describe("mergeDuplicates", () => {
	const baseRow = (overrides: Partial<NormalizedRatelogRow> = {}): NormalizedRatelogRow => ({
		pid: 100,
		uid: 50,
		username: "alice",
		dimension: RatingDimension.Credits,
		dateline: 1_700_000_000,
		score: 5,
		reason: "ok",
		...overrides,
	});

	it("passes single-row buckets through unchanged", () => {
		const result = mergeDuplicates([baseRow({ pid: 1 }), baseRow({ pid: 2 })]);
		expect(result.merged).toHaveLength(2);
		expect(result.mergedKeys).toHaveLength(0);
		expect(result.merged.every((r) => r.sourceRowCount === 1)).toBe(true);
	});

	it("merges duplicate (pid, uid, dimension): SUM(score), MIN(dateline), longest reason", () => {
		const result = mergeDuplicates([
			baseRow({ dateline: 1_700_000_100, score: 5, reason: "short" }),
			baseRow({ dateline: 1_700_000_000, score: 7, reason: "much-longer-reason" }),
			baseRow({ dateline: 1_700_000_050, score: 3, reason: "mid" }),
		]);
		expect(result.merged).toHaveLength(1);
		const m = result.merged[0];
		expect(m.score).toBe(15);
		expect(m.createdAt).toBe(1_700_000_000);
		expect(m.reason).toBe("much-longer-reason");
		expect(m.sourceRowCount).toBe(3);
		expect(result.mergedKeys).toHaveLength(1);
		expect(result.mergedKeys[0]).toMatchObject({ pid: 100, uid: 50, sourceCount: 3, sumScore: 15 });
	});

	it("keeps different dimensions in separate buckets", () => {
		const result = mergeDuplicates([
			baseRow({ dimension: RatingDimension.Credits, score: 5 }),
			baseRow({ dimension: RatingDimension.Coins, score: 1 }),
		]);
		expect(result.merged).toHaveLength(2);
	});
});

describe("applyMapping", () => {
	const merged = (pid: number, uid: number): MergedRatelogRow => ({
		pid,
		uid,
		username: "u",
		dimension: RatingDimension.Coins,
		createdAt: 1,
		score: 2,
		reason: "",
		sourceRowCount: 1,
	});

	it("drops rows whose uid is missing", () => {
		const result = applyMapping(
			[merged(10, 1), merged(20, 2)],
			(uid) => uid === 1,
			(pid) => (pid === 10 || pid === 20 ? pid * 7 : null),
		);
		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]).toMatchObject({ pid: 10, threadId: 70 });
		expect(result.droppedUid).toHaveLength(1);
		expect(result.droppedUid[0].uid).toBe(2);
		expect(result.droppedPid).toHaveLength(0);
	});

	it("drops rows whose pid has no thread mapping", () => {
		const result = applyMapping(
			[merged(10, 1), merged(20, 1)],
			() => true,
			(pid) => (pid === 10 ? 700 : null),
		);
		expect(result.accepted).toHaveLength(1);
		expect(result.droppedPid).toHaveLength(1);
		expect(result.droppedPid[0].pid).toBe(20);
	});

	it("attributes the drop to uid when both are missing", () => {
		const result = applyMapping(
			[merged(99, 99)],
			() => false,
			() => null,
		);
		expect(result.droppedUid).toHaveLength(1);
		expect(result.droppedPid).toHaveLength(0);
	});
});

describe("SQL chunk builders", () => {
	it("escapes single quotes via doubling, strips NULL bytes", () => {
		expect(sqlString("hello")).toBe("'hello'");
		expect(sqlString("it's")).toBe("'it''s'");
		expect(sqlString("with\0null")).toBe("'withnull'");
	});

	it("buildInsertChunk emits one VALUES tuple per accepted row", () => {
		const accepted: AcceptedRow[] = [
			{
				pid: 10,
				uid: 50,
				username: "alice",
				dimension: RatingDimension.Credits,
				createdAt: 1,
				score: 5,
				reason: "great",
				sourceRowCount: 1,
				threadId: 700,
			},
			{
				pid: 11,
				uid: 51,
				username: "bob's",
				dimension: RatingDimension.Coins,
				createdAt: 2,
				score: -2,
				reason: "warn",
				sourceRowCount: 1,
				threadId: 701,
			},
		];
		const sql = buildInsertChunk(accepted);
		expect(sql.startsWith("INSERT INTO post_ratings")).toBe(true);
		expect(sql).toContain("(10, 700, 50, 'alice', 1, 5, 'great', 1, 0, 0)");
		expect(sql).toContain("(11, 701, 51, 'bob''s', 2, -2, 'warn', 2, 0, 0)");
		expect(sql.trim().endsWith(";")).toBe(true);
	});

	it("buildInsertChunk returns empty string when no rows", () => {
		expect(buildInsertChunk([])).toBe("");
	});

	it("chunkRows splits to caller-defined size", () => {
		const rows = Array.from({ length: 12 }, (_, i) => i);
		expect(chunkRows(rows, 5)).toEqual([
			[0, 1, 2, 3, 4],
			[5, 6, 7, 8, 9],
			[10, 11],
		]);
	});

	it("chunkRows rejects zero or negative size", () => {
		expect(() => chunkRows([1, 2, 3], 0)).toThrow();
		expect(() => chunkRows([1, 2, 3], -1)).toThrow();
	});
});

describe("CSV + SUMMARY rendering", () => {
	const droppedSamples: MergedRatelogRow[] = [
		{
			pid: 999,
			uid: 1,
			username: "ghost",
			dimension: RatingDimension.Credits,
			createdAt: 1234,
			score: 5,
			reason: 'has,comma "and quote"',
			sourceRowCount: 1,
		},
	];

	it("renderDroppedCsv writes header + escapes commas/quotes", () => {
		const csv = renderDroppedCsv("uid", droppedSamples);
		const lines = csv.trim().split("\n");
		expect(lines[0]).toBe("pid,uid,dimension,score,created_at,reason");
		expect(lines[1]).toContain('"has,comma ""and quote"""');
	});

	it("renderMergedCsv writes header + numeric columns", () => {
		const csv = renderMergedCsv({
			merged: [],
			mergedKeys: [
				{
					pid: 1,
					uid: 2,
					dimension: RatingDimension.Coins,
					sourceCount: 3,
					sumScore: 9,
					minCreatedAt: 1234,
					reasonSourceLength: 8,
				},
			],
		});
		const lines = csv.trim().split("\n");
		expect(lines[0]).toBe(
			"pid,uid,dimension,source_rows,sum_score,min_created_at,reason_source_length",
		);
		expect(lines[1]).toBe("1,2,2,3,9,1234,8");
	});

	it("renderSummaryMarkdown includes mapping mtime, row counts, canonical path", () => {
		const md = renderSummaryMarkdown({
			dumpPath: "ref/dump.sql.gz",
			mappingDbPath: "output/ellie.db",
			mappingDbMtime: "2026-05-14T00:00:00.000Z",
			mappingUserCount: 1_141_833,
			mappingPostCount: 9_510_276,
			totalRawRows: 63_082,
			normalizedRows: 63_000,
			droppedExtcredits: 50,
			droppedZeroIds: 32,
			mergedKeyCount: 69,
			mergedSourceRowsCollapsed: 95,
			acceptedRows: 60_000,
			droppedUidRows: 2000,
			droppedPidRows: 1000,
			sumScoreCredits: 12345,
			sumScoreCoins: 67890,
			chunkFileCount: 13,
			chunkSize: 5000,
			rebuildSql: "skipped",
			rebuildReason: "posts list aggregates via realtime GROUP BY",
		});
		expect(md).toContain("output/ellie.db");
		expect(md).toContain("mtime 2026-05-14T00:00:00.000Z");
		expect(md).toContain("1141833");
		expect(md).toContain("9510276");
		expect(md).toContain("**Accepted (inserted)** | **60000** |");
		expect(md).toContain("packages/migrate/src/transform/ratelog.ts");
		expect(md).toContain("scripts/migrate/` is frozen legacy");
	});
});
