#!/usr/bin/env bun
/**
 * backfill-coins.ts — Extract extcredits2 (同钱) from MySQL dump and generate
 * D1 UPDATE SQL to backfill the `coins` column.
 *
 * Phase 1 only migrated `credits` (= extcredits1 = 积分). This script reads
 * the `pre_common_member_count` table from the Discuz dump, extracts each
 * user's extcredits2 value, and produces:
 *   1. Verification report (sample rows + aggregate totals + D1 check SQL)
 *   2. Chunked SQL files with batched UPDATEs
 *
 * Usage:
 *   # Step 1 — verify (no SQL generated)
 *   bun run scripts/backfill-coins.ts --verify
 *
 *   # Step 2 — generate SQL (default 5000 statements per chunk file)
 *   bun run scripts/backfill-coins.ts --generate
 *
 *   # Step 2 — generate with custom chunk size
 *   bun run scripts/backfill-coins.ts --generate --chunk-size 10000
 *
 * Output goes to reference/generated/backfill-coins-YYYYMMDDHHMMSSmmm/
 * (gitignored via reference/). Each run creates a unique subdirectory
 * with chunk SQL files and a manifest.json for auditability.
 *
 * Execute each chunk against production D1:
 *   DIR=reference/generated/backfill-coins-YYYYMMDDHHMMSSmmm
 *   for f in $DIR/backfill-coins-*.sql; do
 *     echo "Executing $f ..."
 *     npx wrangler d1 execute tongjinet-db --remote \
 *       -c apps/worker/wrangler.toml --file="$f"
 *   done
 */

import { mkdirSync } from "node:fs";
import { parseDumpFile } from "./migrate/extract/parser";

const SOURCE_DIR = "reference/db";
// pre_common_member_count INSERT data lives in user_extra.sql.gz
// (main_small.sql.gz only has DDL for this table)
const DUMP_FILE = `${SOURCE_DIR}/user_extra.sql.gz`;
const OUTPUT_ROOT = "reference/generated";

// pre_common_member_count column indices (from packages/migrate extractors)
const COL_UID = 0;
const COL_EXTCREDITS2 = 2;

const DEFAULT_CHUNK_SIZE = 5000;

// Spot-check UIDs for post-execution verification
const SPOT_CHECK_UIDS = [119966, 100090, 98977, 217181, 1087538];

interface CoinEntry {
	uid: number;
	coins: number;
}

async function extractCoinsFromDump(): Promise<CoinEntry[]> {
	const entries: CoinEntry[] = [];

	await parseDumpFile(DUMP_FILE, "pre_common_member_count", (row) => {
		const uid = Number(row[COL_UID]);
		const coins = Number(row[COL_EXTCREDITS2]) || 0;
		if (uid > 0) {
			entries.push({ uid, coins });
		}
	});

	return entries;
}

function printVerification(entries: CoinEntry[]): void {
	const total = entries.length;
	const withCoins = entries.filter((e) => e.coins > 0);
	const zeroCoins = entries.filter((e) => e.coins === 0);
	const totalCoinsSum = entries.reduce((sum, e) => sum + e.coins, 0);
	const maxCoins = entries.reduce((max, e) => Math.max(max, e.coins), 0);
	const minNonZero = withCoins.reduce((min, e) => Math.min(min, e.coins), Number.MAX_SAFE_INTEGER);

	console.log("═══════════════════════════════════════════════════════════");
	console.log("  COINS BACKFILL VERIFICATION REPORT");
	console.log("═══════════════════════════════════════════════════════════\n");

	console.log("  Dump Aggregate Totals:");
	console.log(`    Total users in member_count:    ${total.toLocaleString()}`);
	console.log(`    Users with coins > 0:           ${withCoins.length.toLocaleString()}`);
	console.log(`    Users with coins = 0:           ${zeroCoins.length.toLocaleString()}`);
	console.log(`    Total coins (sum):              ${totalCoinsSum.toLocaleString()}`);
	console.log(`    Max coins (single user):        ${maxCoins.toLocaleString()}`);
	if (withCoins.length > 0) {
		console.log(`    Min non-zero coins:             ${minNonZero.toLocaleString()}`);
		console.log(
			`    Average coins (non-zero only):  ${Math.round(totalCoinsSum / withCoins.length).toLocaleString()}`,
		);
	}

	// Top 10 by coins
	const top10 = [...entries].sort((a, b) => b.coins - a.coins).slice(0, 10);
	console.log("\n  Top 10 Users by Coins:");
	console.log("    UID        | Coins");
	console.log("    -----------|----------------");
	for (const e of top10) {
		console.log(`    ${String(e.uid).padEnd(10)} | ${e.coins.toLocaleString()}`);
	}

	// Distribution buckets
	const buckets = [
		{ label: "0", min: 0, max: 0 },
		{ label: "1-99", min: 1, max: 99 },
		{ label: "100-999", min: 100, max: 999 },
		{ label: "1,000-9,999", min: 1000, max: 9999 },
		{ label: "10,000-99,999", min: 10000, max: 99999 },
		{ label: "100,000-999,999", min: 100000, max: 999999 },
		{ label: "1,000,000+", min: 1000000, max: Number.MAX_SAFE_INTEGER },
	];
	console.log("\n  Distribution:");
	console.log("    Range            | Count");
	console.log("    -----------------|--------");
	for (const b of buckets) {
		const count = entries.filter((e) => e.coins >= b.min && e.coins <= b.max).length;
		if (count > 0) {
			console.log(`    ${b.label.padEnd(17)} | ${count.toLocaleString()}`);
		}
	}

	// Sample rows (first 5 non-zero, for spot-check against source dump)
	const sample = withCoins.slice(0, 5);
	console.log("\n  Sample Rows (first 5 non-zero, for spot-check):");
	console.log("    UID        | Coins");
	console.log("    -----------|----------------");
	for (const e of sample) {
		console.log(`    ${String(e.uid).padEnd(10)} | ${e.coins.toLocaleString()}`);
	}

	// Spot-check expected values for verification queries
	const spotChecks = SPOT_CHECK_UIDS.map((uid) => {
		const entry = entries.find((e) => e.uid === uid);
		return { uid, coins: entry?.coins ?? "NOT IN DUMP" };
	});

	console.log("\n═══════════════════════════════════════════════════════════");
	console.log("  D1 VERIFICATION QUERIES");
	console.log("═══════════════════════════════════════════════════════════\n");

	console.log("  ┌─ BEFORE execution (run these first) ──────────────────");
	console.log("  │");
	console.log("  │  -- Baseline snapshot: all coins should be 0");
	console.log("  │  SELECT COUNT(*) AS total_users,");
	console.log("  │         COUNT(CASE WHEN coins <> 0 THEN 1 END) AS nonzero_before,");
	console.log("  │         COALESCE(SUM(coins), 0) AS sum_before");
	console.log("  │  FROM users;");
	console.log("  │");
	console.log("  │  -- D1 user count (compare with dump's 70,943):");
	console.log("  │  SELECT COUNT(*) AS d1_total FROM users;");
	console.log("  └───────────────────────────────────────────────────────\n");

	console.log("  ┌─ AFTER execution ─────────────────────────────────────");
	console.log("  │");
	console.log("  │  -- Verify totals (values are UPPER BOUNDS from dump;");
	console.log("  │  -- actual will be ≤ these if D1 has fewer users):");
	console.log("  │  SELECT COUNT(*) AS total_users,");
	console.log("  │         COUNT(CASE WHEN coins <> 0 THEN 1 END) AS nonzero_after,");
	console.log("  │         COALESCE(SUM(coins), 0) AS sum_after");
	console.log("  │  FROM users;");
	console.log(
		`  │  -- Expected upper bounds: nonzero ≤ ${withCoins.length.toLocaleString()}, sum ≤ ${totalCoinsSum.toLocaleString()}`,
	);
	console.log("  │");
	console.log("  │  -- Spot-check known users:");
	console.log(
		`  │  SELECT id, username, coins FROM users WHERE id IN (${SPOT_CHECK_UIDS.join(",")});`,
	);
	console.log("  │  -- Expected values:");
	for (const sc of spotChecks) {
		console.log(
			`  │  --   uid ${String(sc.uid).padEnd(8)} → coins = ${typeof sc.coins === "number" ? sc.coins.toLocaleString() : sc.coins}`,
		);
	}
	console.log("  └───────────────────────────────────────────────────────\n");

	console.log("  ⚠️  NOTE: The dump contains 70,943 member_count rows. If D1 has");
	console.log("  fewer users, some UPDATEs will match 0 rows (WHERE id = ? finds");
	console.log("  nothing). This is harmless but means post-execution totals will be");
	console.log("  less than the dump aggregates above. The spot-check query confirms");
	console.log("  correctness for users that DO exist in D1.");

	console.log("\n═══════════════════════════════════════════════════════════");
}

function generateChunks(
	entries: CoinEntry[],
	chunkSize: number,
): { filename: string; content: string }[] {
	const nonZero = entries.filter((e) => e.coins > 0);
	const totalChunks = Math.ceil(nonZero.length / chunkSize);
	const totalCoinsSum = nonZero.reduce((s, e) => s + e.coins, 0);
	const chunks: { filename: string; content: string }[] = [];

	for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
		const start = chunkIdx * chunkSize;
		const end = Math.min(start + chunkSize, nonZero.length);
		const slice = nonZero.slice(start, end);
		const chunkNum = chunkIdx + 1;
		const padded = String(chunkNum).padStart(String(totalChunks).length, "0");
		const filename = `backfill-coins-${padded}.sql`;

		const lines: string[] = [
			`-- ${filename} — Generated by scripts/backfill-coins.ts`,
			`-- Chunk ${chunkNum}/${totalChunks} (rows ${start + 1}–${end} of ${nonZero.length})`,
			`-- Generated at: ${new Date().toISOString()}`,
		];

		if (chunkIdx === 0) {
			lines.push("--");
			lines.push("-- IMPORTANT: Back up D1 before executing any chunk.");
			lines.push(`-- Total updates across all chunks: ${nonZero.length} users`);
			lines.push(`-- Dump total coins (upper bound): ${totalCoinsSum.toLocaleString()}`);
			lines.push("-- Actual D1 totals will be ≤ dump values if D1 has fewer users.");
		}

		lines.push("");

		for (const e of slice) {
			lines.push(`UPDATE users SET coins = ${e.coins} WHERE id = ${e.uid};`);
		}

		chunks.push({ filename, content: `${lines.join("\n")}\n` });
	}

	return chunks;
}

interface Manifest {
	generatedAt: string;
	source: string;
	chunkSize: number;
	totalChunks: number;
	totalUpdates: number;
	totalCoinsDump: number;
	note: string;
	spotCheckUids: Record<number, number | string>;
	files: string[];
}

function buildManifest(
	entries: CoinEntry[],
	chunks: { filename: string }[],
	chunkSize: number,
	timestamp: string,
): Manifest {
	const nonZero = entries.filter((e) => e.coins > 0);
	const spotChecks: Record<number, number | string> = {};
	for (const uid of SPOT_CHECK_UIDS) {
		const entry = entries.find((e) => e.uid === uid);
		spotChecks[uid] = entry?.coins ?? "NOT_IN_DUMP";
	}
	return {
		generatedAt: timestamp,
		source: DUMP_FILE,
		chunkSize,
		totalChunks: chunks.length,
		totalUpdates: nonZero.length,
		totalCoinsDump: nonZero.reduce((s, e) => s + e.coins, 0),
		note: "Totals are upper bounds from dump; actual D1 values may be lower if D1 has fewer users.",
		spotCheckUids: spotChecks,
		files: chunks.map((c) => c.filename),
	};
}

function parseChunkSize(args: string[]): number {
	const idx = args.indexOf("--chunk-size");
	if (idx !== -1 && idx + 1 < args.length) {
		const val = Number(args[idx + 1]);
		if (Number.isFinite(val) && val > 0) {
			return Math.floor(val);
		}
		console.error(`Invalid --chunk-size value: ${args[idx + 1]}`);
		process.exit(1);
	}
	return DEFAULT_CHUNK_SIZE;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args.includes("--generate") ? "generate" : "verify";
const chunkSize = parseChunkSize(args);

console.log(`🔄 Coins Backfill Script (mode: ${mode})\n`);
console.log(`   Source: ${DUMP_FILE}`);
if (mode === "generate") {
	console.log(`   Chunk size: ${chunkSize.toLocaleString()} statements per file`);
	console.log(`   Output root: ${OUTPUT_ROOT}/`);
}
console.log("");

try {
	const entries = await extractCoinsFromDump();
	console.log(`   Extracted ${entries.length.toLocaleString()} member_count rows\n`);

	printVerification(entries);

	if (mode === "generate") {
		// Timestamped subdirectory for auditability — never collides with prior runs.
		// Uses millisecond precision to avoid same-second collisions.
		const now = new Date();
		const pad = (n: number, w = 2) => String(n).padStart(w, "0");
		const ts = [
			now.getFullYear(),
			pad(now.getMonth() + 1),
			pad(now.getDate()),
			"-",
			pad(now.getHours()),
			pad(now.getMinutes()),
			pad(now.getSeconds()),
			pad(now.getMilliseconds(), 3),
		].join("");
		const outDir = `${OUTPUT_ROOT}/backfill-coins-${ts}`;
		mkdirSync(outDir, { recursive: true });

		const chunks = generateChunks(entries, chunkSize);

		for (const chunk of chunks) {
			await Bun.write(`${outDir}/${chunk.filename}`, chunk.content);
		}

		const manifest = buildManifest(entries, chunks, chunkSize, now.toISOString());
		await Bun.write(`${outDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

		const nonZero = entries.filter((e) => e.coins > 0).length;
		console.log(`\n✅ SQL written to ${outDir}/`);
		console.log(`   ${chunks.length} chunk file(s), ${nonZero.toLocaleString()} total UPDATEs`);
		console.log("   manifest.json written");
		for (const chunk of chunks) {
			console.log(`     ${chunk.filename}`);
		}
		console.log("");
		console.log("   To apply to production D1 (one chunk at a time):");
		console.log(`   for f in ${outDir}/backfill-coins-*.sql; do`);
		console.log('     echo "Executing $f ..."');
		console.log("     npx wrangler d1 execute tongjinet-db --remote \\");
		console.log('       -c apps/worker/wrangler.toml --file="$f"');
		console.log("   done");
	} else {
		console.log("\n💡 Run with --generate to produce the SQL files.");
		console.log("   Optional: --chunk-size N (default 5000)");
	}
} catch (err) {
	console.error("Fatal error:", err);
	process.exit(1);
}
