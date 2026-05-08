#!/usr/bin/env bun
/**
 * import-checkins.ts — Merge pre_dsu_paulsign + pre_dsu_paulsign2 from MySQL
 * dump and generate D1 INSERT SQL to populate the `user_checkins` table.
 *
 * Source: db_tongji_main_full.sql.gz (Discuz dsu_paulsign plugin tables)
 * Target: user_checkins (migration 0033)
 *
 * Merge logic:
 *   - Primary source is `pre_dsu_paulsign` (2,797 rows expected)
 *   - `pre_dsu_paulsign2` (108 rows) is a backup/overflow table
 *   - Overlapping UIDs (in both tables): keep primary table row
 *   - Unique UIDs (only in paulsign2): merge into output
 *
 * Usage:
 *   # Step 1 — verify (no SQL generated)
 *   bun run scripts/import-checkins.ts --verify
 *
 *   # Step 2 — generate SQL
 *   bun run scripts/import-checkins.ts --generate
 *
 *   # With custom chunk size
 *   bun run scripts/import-checkins.ts --generate --chunk-size 1000
 *
 * Output: reference/generated/import-checkins-YYYYMMDDHHMMSSmmm/
 *   - import-checkins-NN.sql (INSERT INTO user_checkins ...)
 *   - manifest.json
 *
 * Production execution order:
 *   1. Deploy worker (migration 0033 creates user_checkins)
 *   2. Baseline: SELECT COUNT(*) FROM user_checkins; -- should be 0
 *   3. Execute SQL chunks in order
 *   4. Verify with manifest spot-check queries
 */

import { mkdirSync } from "node:fs";
import { parseDumpFile } from "./migrate/extract/parser";

// ─── Config ─────────────────────────────────────────────────

const DUMP_FILE = "reference/db/db_tongji_main_full.sql.gz";
const OUTPUT_ROOT = "reference/generated";
const DEFAULT_CHUNK_SIZE = 1000;

// Column indices in pre_dsu_paulsign / pre_dsu_paulsign2 INSERT VALUES
// (uid, time, days, lasted, mdays, reward, lastreward, qdxq, todaysay)
const COL_UID = 0;
const COL_TIME = 1;
const COL_DAYS = 2;
const COL_LASTED = 3;
const COL_MDAYS = 4;
const COL_REWARD = 5;
const COL_LASTREWARD = 6;
const COL_QDXQ = 7;
const COL_TODAYSAY = 8;

// Spot-check UIDs (top users by total days from investigation)
const SPOT_CHECK_UIDS = [119966, 8782, 217181, 105282, 98977];

// ─── Types ──────────────────────────────────────────────────

interface CheckinRow {
	uid: number;
	lastCheckinAt: number;
	totalDays: number;
	streakDays: number;
	monthDays: number;
	rewardTotal: number;
	lastReward: number;
	mood: string;
	message: string;
}

// ─── Parse ──────────────────────────────────────────────────

async function parseTable(tableName: string): Promise<Map<number, CheckinRow>> {
	const rows = new Map<number, CheckinRow>();

	await parseDumpFile(DUMP_FILE, tableName, (row) => {
		const uid = Number(row[COL_UID]);
		if (uid <= 0) return;

		rows.set(uid, {
			uid,
			lastCheckinAt: Number(row[COL_TIME]) || 0,
			totalDays: Number(row[COL_DAYS]) || 0,
			streakDays: Number(row[COL_LASTED]) || 0,
			monthDays: Number(row[COL_MDAYS]) || 0,
			rewardTotal: Number(row[COL_REWARD]) || 0,
			lastReward: Number(row[COL_LASTREWARD]) || 0,
			mood: String(row[COL_QDXQ] ?? ""),
			message: String(row[COL_TODAYSAY] ?? ""),
		});
	});

	return rows;
}

function mergeRows(
	primary: Map<number, CheckinRow>,
	backup: Map<number, CheckinRow>,
): { merged: CheckinRow[]; overlapCount: number; uniqueBackupCount: number } {
	// Start with all primary rows
	const merged = new Map(primary);
	let overlapCount = 0;
	let uniqueBackupCount = 0;

	for (const [uid, row] of backup) {
		if (merged.has(uid)) {
			// Overlapping UID — keep primary table row
			overlapCount++;
		} else {
			// Unique UID only in backup — merge
			merged.set(uid, row);
			uniqueBackupCount++;
		}
	}

	// Sort by UID for deterministic output
	const result = [...merged.values()].sort((a, b) => a.uid - b.uid);
	return { merged: result, overlapCount, uniqueBackupCount };
}

// ─── SQL escape ─────────────────────────────────────────────

/** Escape a string for SQLite TEXT literal (single-quote doubling). */
function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

// ─── Verify ─────────────────────────────────────────────────

function printVerification(
	primary: Map<number, CheckinRow>,
	backup: Map<number, CheckinRow>,
	merged: CheckinRow[],
	overlapCount: number,
	uniqueBackupCount: number,
): void {
	const totalReward = merged.reduce((s, r) => s + r.rewardTotal, 0);
	const totalDaysSum = merged.reduce((s, r) => s + r.totalDays, 0);

	console.log("═══════════════════════════════════════════════════════════");
	console.log("  CHECKIN IMPORT VERIFICATION REPORT");
	console.log("═══════════════════════════════════════════════════════════\n");

	console.log("  Source Tables:");
	console.log(`    pre_dsu_paulsign  (primary):  ${primary.size.toLocaleString()} rows`);
	console.log(`    pre_dsu_paulsign2 (backup):   ${backup.size.toLocaleString()} rows`);
	console.log("");
	console.log("  Merge Result:");
	console.log(`    Overlapping UIDs (kept primary): ${overlapCount.toLocaleString()}`);
	console.log(`    Unique backup UIDs (merged):     ${uniqueBackupCount.toLocaleString()}`);
	console.log(`    Final merged rows:               ${merged.length.toLocaleString()}`);

	console.log("\n  Aggregates:");
	console.log(`    Total reward (sum):       ${totalReward.toLocaleString()}`);
	console.log(`    Total days (sum):         ${totalDaysSum.toLocaleString()}`);

	// Top 10 by total days
	const top10 = [...merged].sort((a, b) => b.totalDays - a.totalDays).slice(0, 10);
	console.log("\n  Top 10 by Total Days:");
	console.log("    UID        | Days   | Reward     | Mood   | Last Sign-in");
	console.log("    -----------|--------|------------|--------|---------------------");
	for (const r of top10) {
		const date =
			r.lastCheckinAt > 0 ? new Date(r.lastCheckinAt * 1000).toISOString().slice(0, 10) : "never";
		console.log(
			`    ${String(r.uid).padEnd(10)} | ${String(r.totalDays).padStart(6)} | ${String(r.rewardTotal).padStart(10).toLocaleString()} | ${r.mood.padEnd(6)} | ${date}`,
		);
	}

	// Mood distribution
	const moodCounts = new Map<string, number>();
	for (const r of merged) {
		const m = r.mood || "(empty)";
		moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1);
	}
	console.log("\n  Mood Distribution:");
	console.log("    Code     | Count");
	console.log("    ---------|-------");
	for (const [mood, count] of [...moodCounts.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`    ${mood.padEnd(9)} | ${count.toLocaleString()}`);
	}

	// Spot-checks
	const spotChecks = SPOT_CHECK_UIDS.map((uid) => {
		const row = merged.find((r) => r.uid === uid);
		return { uid, row };
	});

	console.log("\n═══════════════════════════════════════════════════════════");
	console.log("  D1 VERIFICATION QUERIES");
	console.log("═══════════════════════════════════════════════════════════\n");

	console.log("  ┌─ BEFORE execution (baseline) ────────────────────────");
	console.log("  │");
	console.log("  │  -- Table should exist and be empty:");
	console.log("  │  SELECT COUNT(*) AS row_count FROM user_checkins;");
	console.log("  │  -- Expected: 0");
	console.log("  └───────────────────────────────────────────────────────\n");

	console.log("  ┌─ AFTER execution ─────────────────────────────────────");
	console.log("  │");
	console.log("  │  -- Verify totals:");
	console.log("  │  SELECT COUNT(*) AS total_rows,");
	console.log("  │         COALESCE(SUM(total_days), 0) AS sum_days,");
	console.log("  │         COALESCE(SUM(reward_total), 0) AS sum_reward");
	console.log("  │  FROM user_checkins;");
	console.log(
		`  │  -- Expected: rows = ${merged.length}, sum_days = ${totalDaysSum}, sum_reward = ${totalReward}`,
	);
	console.log("  │");
	console.log("  │  -- Spot-check known users:");
	console.log(
		`  │  SELECT user_id, total_days, reward_total, mood FROM user_checkins WHERE user_id IN (${SPOT_CHECK_UIDS.join(",")});`,
	);
	console.log("  │  -- Expected values:");
	for (const sc of spotChecks) {
		if (sc.row) {
			console.log(
				`  │  --   uid ${String(sc.uid).padEnd(8)} → days=${sc.row.totalDays}, reward=${sc.row.rewardTotal.toLocaleString()}, mood=${sc.row.mood}`,
			);
		} else {
			console.log(`  │  --   uid ${String(sc.uid).padEnd(8)} → NOT IN DUMP`);
		}
	}
	console.log("  └───────────────────────────────────────────────────────\n");
}

// ─── Generate ───────────────────────────────────────────────

function generateChunks(
	rows: CheckinRow[],
	chunkSize: number,
): { filename: string; content: string }[] {
	const totalChunks = Math.ceil(rows.length / chunkSize);
	const chunks: { filename: string; content: string }[] = [];

	for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
		const start = chunkIdx * chunkSize;
		const end = Math.min(start + chunkSize, rows.length);
		const slice = rows.slice(start, end);
		const chunkNum = chunkIdx + 1;
		const padded = String(chunkNum).padStart(String(totalChunks).length, "0");
		const filename = `import-checkins-${padded}.sql`;

		const lines: string[] = [
			`-- ${filename} — Generated by scripts/import-checkins.ts`,
			`-- Chunk ${chunkNum}/${totalChunks} (rows ${start + 1}–${end} of ${rows.length})`,
			`-- Generated at: ${new Date().toISOString()}`,
		];

		if (chunkIdx === 0) {
			lines.push("--");
			lines.push("-- IMPORTANT: Verify user_checkins table is empty before executing.");
			lines.push(`-- Total INSERTs across all chunks: ${rows.length}`);
			lines.push("-- Source: pre_dsu_paulsign + pre_dsu_paulsign2 (merged)");
		}

		lines.push("");

		for (const r of slice) {
			lines.push(
				`INSERT INTO user_checkins (user_id, total_days, month_days, streak_days, reward_total, last_reward, mood, message, last_checkin_at) VALUES (${r.uid}, ${r.totalDays}, ${r.monthDays}, ${r.streakDays}, ${r.rewardTotal}, ${r.lastReward}, '${sqlEscape(r.mood)}', '${sqlEscape(r.message)}', ${r.lastCheckinAt});`,
			);
		}

		chunks.push({ filename, content: `${lines.join("\n")}\n` });
	}

	return chunks;
}

interface Manifest {
	generatedAt: string;
	source: string;
	primaryTableRows: number;
	backupTableRows: number;
	overlapCount: number;
	uniqueBackupMerged: number;
	totalInserts: number;
	chunkSize: number;
	totalChunks: number;
	aggregates: {
		sumTotalDays: number;
		sumRewardTotal: number;
	};
	spotCheckUids: Record<
		number,
		{ totalDays: number; rewardTotal: number; mood: string } | "NOT_IN_DUMP"
	>;
	files: string[];
}

function buildManifest(
	primary: Map<number, CheckinRow>,
	backup: Map<number, CheckinRow>,
	merged: CheckinRow[],
	overlapCount: number,
	uniqueBackupCount: number,
	chunks: { filename: string }[],
	chunkSize: number,
	timestamp: string,
): Manifest {
	const spotChecks: Manifest["spotCheckUids"] = {};
	for (const uid of SPOT_CHECK_UIDS) {
		const row = merged.find((r) => r.uid === uid);
		spotChecks[uid] = row
			? { totalDays: row.totalDays, rewardTotal: row.rewardTotal, mood: row.mood }
			: "NOT_IN_DUMP";
	}

	return {
		generatedAt: timestamp,
		source: DUMP_FILE,
		primaryTableRows: primary.size,
		backupTableRows: backup.size,
		overlapCount,
		uniqueBackupMerged: uniqueBackupCount,
		totalInserts: merged.length,
		chunkSize,
		totalChunks: chunks.length,
		aggregates: {
			sumTotalDays: merged.reduce((s, r) => s + r.totalDays, 0),
			sumRewardTotal: merged.reduce((s, r) => s + r.rewardTotal, 0),
		},
		spotCheckUids: spotChecks,
		files: chunks.map((c) => c.filename),
	};
}

// ─── CLI ────────────────────────────────────────────────────

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

// ─── Main ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args.includes("--generate") ? "generate" : "verify";
const chunkSize = parseChunkSize(args);

console.log(`🔄 Checkin Import Script (mode: ${mode})\n`);
console.log(`   Source: ${DUMP_FILE}`);
if (mode === "generate") {
	console.log(`   Chunk size: ${chunkSize.toLocaleString()} statements per file`);
	console.log(`   Output root: ${OUTPUT_ROOT}/`);
}
console.log("");

try {
	console.log("   Parsing pre_dsu_paulsign (primary) ...");
	const primary = await parseTable("pre_dsu_paulsign");
	console.log(`   → ${primary.size.toLocaleString()} rows\n`);

	console.log("   Parsing pre_dsu_paulsign2 (backup) ...");
	const backup = await parseTable("pre_dsu_paulsign2");
	console.log(`   → ${backup.size.toLocaleString()} rows\n`);

	const { merged, overlapCount, uniqueBackupCount } = mergeRows(primary, backup);
	console.log(
		`   Merge: ${overlapCount} overlaps (kept primary), ${uniqueBackupCount} unique backup UIDs merged`,
	);
	console.log(`   Final: ${merged.length.toLocaleString()} rows\n`);

	printVerification(primary, backup, merged, overlapCount, uniqueBackupCount);

	if (mode === "generate") {
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
		const outDir = `${OUTPUT_ROOT}/import-checkins-${ts}`;
		mkdirSync(outDir, { recursive: true });

		const chunks = generateChunks(merged, chunkSize);

		for (const chunk of chunks) {
			await Bun.write(`${outDir}/${chunk.filename}`, chunk.content);
		}

		const manifest = buildManifest(
			primary,
			backup,
			merged,
			overlapCount,
			uniqueBackupCount,
			chunks,
			chunkSize,
			now.toISOString(),
		);
		await Bun.write(`${outDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

		console.log(`\n✅ SQL written to ${outDir}/`);
		console.log(
			`   ${chunks.length} chunk file(s), ${merged.length.toLocaleString()} total INSERTs`,
		);
		console.log("   manifest.json written");
		for (const chunk of chunks) {
			console.log(`     ${chunk.filename}`);
		}
		console.log("");
		console.log("   To apply to production D1 (one chunk at a time):");
		console.log(`   for f in ${outDir}/import-checkins-*.sql; do`);
		console.log('     echo "Executing $f ..."');
		console.log("     npx wrangler d1 execute tongjinet-db --remote \\");
		console.log('       -c apps/worker/wrangler.toml --file="$f"');
		console.log("   done");
	} else {
		console.log("\n💡 Run with --generate to produce the SQL files.");
		console.log("   Optional: --chunk-size N (default 1000)");
	}
} catch (err) {
	console.error("Fatal error:", err);
	process.exit(1);
}
