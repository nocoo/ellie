#!/usr/bin/env bun
/**
 * Ratelog ETL CLI — dry-run generator for Phase 5 (docs/22 §8).
 *
 * Reads `pre_forum_ratelog` from a gzipped Discuz dump, looks up uid/pid
 * against a migrated D1 mirror (default `output/ellie.db`), dedupe-merges,
 * and writes:
 *
 *   output/post-ratings-import-YYYY-MM-DD/
 *     0001-insert-post-ratings-N.sql   (chunkSize rows each)
 *     SUMMARY.md
 *     dropped-uid.csv
 *     dropped-pid.csv
 *     merged.csv
 *
 * No prod D1 writes. The generated SQL is reviewed by哥 + reviewer before
 * any `wrangler d1 execute --remote` step (out of scope for Phase 5).
 *
 * Canonical path (per IMPORT-PLAN.md): `packages/migrate/` is the live
 * pipeline; `scripts/migrate/` is frozen legacy and must not be touched.
 *
 * Usage:
 *   bun run packages/migrate/src/ratelog-etl.ts \
 *     [--dump <path>] [--mapping-db <path>] [--output-dir <path>] \
 *     [--chunk-size <n>] [--reason-max <n>]
 *
 * Defaults:
 *   --dump          reference/db/2026-05-14/db_tongji_main_full.sql.gz
 *   --mapping-db    output/ellie.db
 *   --output-dir    output/post-ratings-import-<today>/
 *   --chunk-size    5000
 *   --reason-max    40 (matches RATING_REASON_MAX_LENGTH)
 */

import { Database } from "bun:sqlite";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RatingDimension } from "@ellie/types";
import { parseDumpFile } from "./extract/parser";
import {
	type EtlSummary,
	type MergedRatelogRow,
	type NormalizedRatelogRow,
	type RatelogRawRow,
	applyMapping,
	buildInsertChunk,
	chunkRows,
	mergeDuplicates,
	normalizeRatelogRow,
	renderDroppedCsv,
	renderMergedCsv,
	renderSummaryMarkdown,
} from "./transform/ratelog";

interface CliOptions {
	dump: string;
	mappingDb: string;
	outputDir: string;
	chunkSize: number;
	reasonMax: number;
}

function todayYmd(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function parseCliArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		dump: "reference/db/2026-05-14/db_tongji_main_full.sql.gz",
		mappingDb: "output/ellie.db",
		outputDir: `output/post-ratings-import-${todayYmd()}`,
		chunkSize: 5000,
		reasonMax: 40,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		switch (arg) {
			case "--dump":
				opts.dump = next();
				break;
			case "--mapping-db":
				opts.mappingDb = next();
				break;
			case "--output-dir":
				opts.outputDir = next();
				break;
			case "--chunk-size":
				opts.chunkSize = Number(next());
				break;
			case "--reason-max":
				opts.reasonMax = Number(next());
				break;
			case "--help":
			case "-h":
				console.log(
					"Usage: bun run packages/migrate/src/ratelog-etl.ts [--dump <path>] [--mapping-db <path>] [--output-dir <path>] [--chunk-size <n>] [--reason-max <n>]",
				);
				process.exit(0);
				break;
			default:
				if (arg) {
					console.error(`Unknown argument: ${arg}`);
					process.exit(2);
				}
		}
	}
	return opts;
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

/**
 * Build in-memory lookup sets for users.id and a (post_id → thread_id) map
 * from the mapping DB. Faster than per-row prepared lookups (62k ratelog
 * rows would issue 124k queries; in-memory is one scan each).
 */
function loadMapping(dbPath: string): {
	hasUser: (uid: number) => boolean;
	getPostThreadId: (pid: number) => number | null;
	userCount: number;
	postCount: number;
} {
	const db = new Database(dbPath, { readonly: true });
	try {
		log(`Loading users from ${dbPath}...`);
		const userRows = db.query<{ id: number }, []>("SELECT id FROM users").all();
		const users = new Set<number>(userRows.map((r) => r.id));
		log(`  ${users.size} users loaded`);

		log(`Loading posts (id, thread_id) from ${dbPath}...`);
		const postRows = db
			.query<{ id: number; thread_id: number }, []>("SELECT id, thread_id FROM posts")
			.all();
		const posts = new Map<number, number>();
		for (const r of postRows) posts.set(r.id, r.thread_id);
		log(`  ${posts.size} posts loaded`);

		return {
			hasUser: (uid) => users.has(uid),
			getPostThreadId: (pid) => posts.get(pid) ?? null,
			userCount: users.size,
			postCount: posts.size,
		};
	} finally {
		db.close();
	}
}

async function main() {
	const opts = parseCliArgs(process.argv.slice(2));
	log(`Dump:        ${opts.dump}`);
	log(`Mapping DB:  ${opts.mappingDb}`);
	log(`Output dir:  ${opts.outputDir}`);
	log(`Chunk size:  ${opts.chunkSize}`);
	log(`Reason max:  ${opts.reasonMax}`);

	mkdirSync(opts.outputDir, { recursive: true });

	// ── Step 1: load mapping ──
	const mappingMtime = statSync(opts.mappingDb).mtime.toISOString();
	const mapping = loadMapping(opts.mappingDb);

	// ── Step 2: stream parse the ratelog dump ──
	let totalRaw = 0;
	let droppedExtcredits = 0;
	let droppedZeroIds = 0;
	const normalized: NormalizedRatelogRow[] = [];

	await parseDumpFile(opts.dump, {
		tableName: "pre_forum_ratelog",
		progressInterval: 10000,
		onProgress: (count) => log(`  parsed ${count} ratelog rows…`),
		onRow: (parsedRow) => {
			totalRaw++;
			// Column order from DDL: pid, uid, username, extcredits, dateline, score, reason
			const raw: RatelogRawRow = {
				pid: Number(parsedRow[0]) || 0,
				uid: Number(parsedRow[1]) || 0,
				username: String(parsedRow[2] ?? ""),
				extcredits: Number(parsedRow[3]) || 0,
				dateline: Number(parsedRow[4]) || 0,
				score: Number(parsedRow[5]) || 0,
				reason: String(parsedRow[6] ?? ""),
			};
			const norm = normalizeRatelogRow(raw, opts.reasonMax);
			if (norm === null) {
				if (raw.extcredits !== 1 && raw.extcredits !== 2) {
					droppedExtcredits++;
				} else {
					droppedZeroIds++;
				}
				return;
			}
			normalized.push(norm);
		},
	});
	log(
		`Parsed ${totalRaw} raw rows; normalized=${normalized.length}, dropped(extcredits)=${droppedExtcredits}, dropped(zero ids)=${droppedZeroIds}`,
	);

	// ── Step 3: dedupe merge ──
	const mergeReport = mergeDuplicates(normalized);
	const mergedSourceRowsCollapsed = mergeReport.mergedKeys.reduce(
		(sum, m) => sum + (m.sourceCount - 1),
		0,
	);
	log(
		`Merged ${mergeReport.mergedKeys.length} duplicate keys (collapsed ${mergedSourceRowsCollapsed} extra rows)`,
	);

	// ── Step 4: uid/pid mapping ──
	const { accepted, droppedUid, droppedPid } = applyMapping(
		mergeReport.merged,
		mapping.hasUser,
		mapping.getPostThreadId,
	);
	log(
		`Mapping: accepted=${accepted.length}, droppedUid=${droppedUid.length}, droppedPid=${droppedPid.length}`,
	);

	// ── Step 5: write 5000-row INSERT chunks ──
	const chunks = chunkRows(accepted, opts.chunkSize);
	for (let i = 0; i < chunks.length; i++) {
		const idx = String(i + 1).padStart(4, "0");
		const filename = `${idx}-insert-post-ratings-${chunks[i].length}.sql`;
		const filePath = join(opts.outputDir, filename);
		writeFileSync(filePath, buildInsertChunk(chunks[i]));
	}
	log(`Wrote ${chunks.length} insert chunk file(s) to ${opts.outputDir}`);

	// ── Step 6: dropped + merged CSVs ──
	writeFileSync(join(opts.outputDir, "dropped-uid.csv"), renderDroppedCsv("uid", droppedUid));
	writeFileSync(join(opts.outputDir, "dropped-pid.csv"), renderDroppedCsv("pid", droppedPid));
	writeFileSync(join(opts.outputDir, "merged.csv"), renderMergedCsv(mergeReport));

	// ── Step 7: SUMMARY.md ──
	const sumScoreCredits = accepted
		.filter((r) => r.dimension === RatingDimension.Credits)
		.reduce((s, r) => s + r.score, 0);
	const sumScoreCoins = accepted
		.filter((r) => r.dimension === RatingDimension.Coins)
		.reduce((s, r) => s + r.score, 0);
	const summary: EtlSummary = {
		dumpPath: opts.dump,
		mappingDbPath: opts.mappingDb,
		mappingDbMtime: mappingMtime,
		mappingUserCount: mapping.userCount,
		mappingPostCount: mapping.postCount,
		totalRawRows: totalRaw,
		normalizedRows: normalized.length,
		droppedExtcredits,
		droppedZeroIds,
		mergedKeyCount: mergeReport.mergedKeys.length,
		mergedSourceRowsCollapsed,
		acceptedRows: accepted.length,
		droppedUidRows: droppedUid.length,
		droppedPidRows: droppedPid.length,
		sumScoreCredits,
		sumScoreCoins,
		chunkFileCount: chunks.length,
		chunkSize: opts.chunkSize,
		rebuildSql: "skipped",
		rebuildReason:
			"posts list aggregates via realtime GROUP BY (docs/22 §5.2); no denormalized counts to rebuild.",
	};
	writeFileSync(join(opts.outputDir, "SUMMARY.md"), renderSummaryMarkdown(summary));
	log("Wrote SUMMARY.md");
	log("Done. Review the output before any prod import.");
}

// Run only when invoked as a CLI; tests can import the helpers directly.
if (import.meta.main) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}

// Used by helper functions / future test importers. Not part of the
// stable public surface — keep them out of index.ts unless needed.
export type { MergedRatelogRow };
