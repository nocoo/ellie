/**
 * D1 import executor — reads manifest.json and executes SQL chunks against
 * remote D1 via `wrangler d1 execute --remote --file`.
 *
 * Features:
 *   - Manifest-driven: only executes files listed in manifest.json
 *   - Ordered by table dependency: forums → users → threads → posts → attachments → user_checkins
 *   - Dry-run mode: prints execution plan without running
 *   - Resume: skips chunks already marked "done" in execution-log.json
 *     (validates manifest fingerprint to prevent stale log reuse)
 *   - Execution log: records status, duration, errors per chunk
 *   - Post-import verification: row counts, max IDs, FK orphan checks
 *
 * Usage:
 *   bun run packages/migrate/src/execute-d1-import.ts \
 *     --manifest output/d1-import-2026-05-09/manifest.json \
 *     --dry-run
 *
 *   bun run packages/migrate/src/execute-d1-import.ts \
 *     --manifest output/d1-import-2026-05-09/manifest.json \
 *     --resume
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Manifest } from "./load/d1-sql-builder";
import {
	FK_RELATIONS,
	IMPORT_TABLE_ORDER,
	computeManifestFingerprint,
	validateManifestStructure,
} from "./load/d1-sql-builder";

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		manifest: { type: "string" },
		"dry-run": { type: "boolean", default: false },
		resume: { type: "boolean", default: false },
	},
});

const MANIFEST_PATH = values.manifest ?? "output/d1-import-2026-05-09/manifest.json";
const DRY_RUN = values["dry-run"] ?? false;
const RESUME = values.resume ?? false;
const NPX_BIN = process.env.EXECUTOR_NPX_BIN ?? "npx";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChunkExecResult {
	file: string;
	table: string;
	status: "done" | "failed" | "skipped";
	started_at: string;
	finished_at: string;
	duration_ms: number;
	error?: string;
}

interface ExecutionLog {
	manifest_path: string;
	manifest_fingerprint: string;
	database: string;
	started_at: string;
	finished_at?: string;
	chunks: ChunkExecResult[];
	verification?: VerificationResult;
}

interface VerificationResult {
	verified_at: string;
	checks: Array<{
		name: string;
		passed: boolean;
		expected?: string | number;
		actual?: string | number;
		details?: string;
	}>;
	passed: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

function loadManifest(path: string): Manifest {
	if (!existsSync(path)) {
		throw new Error(`Manifest not found: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
}

function loadExecutionLog(path: string): ExecutionLog | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as ExecutionLog;
}

function saveExecutionLog(path: string, execLog: ExecutionLog): void {
	writeFileSync(path, `${JSON.stringify(execLog, null, "\t")}\n`);
}

function wranglerExecute(
	sqlFile: string,
	dbName: string,
	cwd: string,
): { success: boolean; error?: string } {
	try {
		execFileSync(
			NPX_BIN,
			["wrangler", "d1", "execute", dbName, "--remote", "--file", sqlFile, "--yes"],
			{
				encoding: "utf-8",
				cwd,
				timeout: 300_000,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		return { success: true };
	} catch (e) {
		const err = e as { stderr?: string; message?: string };
		return { success: false, error: err.stderr || err.message || "Unknown error" };
	}
}

function wranglerQuery(sql: string, dbName: string, cwd: string): string {
	try {
		return execFileSync(
			NPX_BIN,
			["wrangler", "d1", "execute", dbName, "--remote", "--command", sql, "--yes", "--json"],
			{
				encoding: "utf-8",
				cwd,
				timeout: 60_000,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
	} catch (e) {
		const err = e as { stdout?: string; stderr?: string };
		return err.stdout || err.stderr || "";
	}
}

// ─── Dry-run ────────────────────────────────────────────────────────────────

function printDryRun(manifest: Manifest, completedFiles: Set<string>): void {
	log("=== DRY RUN — Execution Plan ===");
	log(`  Database: ${manifest.production_state.database.name}`);
	log(`  Total chunks: ${manifest.total_chunks}`);
	log(`  Total rows: ${manifest.total_rows.toLocaleString()}`);
	log("");

	for (const table of IMPORT_TABLE_ORDER) {
		const tableInfo = manifest.tables[table];
		if (!tableInfo) continue;

		const maxIdNote =
			tableInfo.prod_max_id !== null
				? ` (prod max_id=${tableInfo.prod_max_id}, new=${tableInfo.source_rows_after_max})`
				: "";
		log(`  ${table} [${tableInfo.strategy}]${maxIdNote}`);

		for (const file of tableInfo.files) {
			const chunk = manifest.chunks.find((c) => c.file === file);
			const status = completedFiles.has(file) ? "SKIP (done)" : "PENDING";
			const bytes = chunk ? `${(chunk.bytes / 1024).toFixed(1)} KB` : "?";
			const rows = chunk ? `${chunk.rows} rows` : "?";
			log(`    ${status}  ${file}  (${rows}, ${bytes})`);
		}
	}

	const pendingChunks = manifest.chunks.filter((c) => !completedFiles.has(c.file));
	const pendingRows = pendingChunks.reduce((s, c) => s + c.rows, 0);
	const pendingBytes = pendingChunks.reduce((s, c) => s + c.bytes, 0);
	log("");
	log(
		`  Pending: ${pendingChunks.length} chunks, ${pendingRows.toLocaleString()} rows, ${(pendingBytes / 1024 / 1024).toFixed(1)} MB`,
	);
	log("  To execute, remove --dry-run flag.");
}

// ─── Verification helpers ───────────────────────────────────────────────────

type VerificationCheck = VerificationResult["checks"][number];

function parseWranglerScalar(jsonOutput: string, field: string): number | null {
	try {
		const parsed = JSON.parse(jsonOutput);
		return (
			parsed[0]?.results?.[0]?.[field] ??
			parsed[0]?.result?.[0]?.[field] ??
			parsed?.results?.[0]?.[field] ??
			null
		);
	} catch {
		return null;
	}
}

function verifyRowCounts(manifest: Manifest, dbName: string, cwd: string): VerificationCheck[] {
	const checks: VerificationCheck[] = [];
	for (const table of IMPORT_TABLE_ORDER) {
		const tableInfo = manifest.tables[table];
		if (!tableInfo) continue;

		const result = wranglerQuery(`SELECT COUNT(*) as cnt FROM ${table}`, dbName, cwd);
		const actual = parseWranglerScalar(result, "cnt");
		if (actual === null) {
			checks.push({ name: `${table} row count`, passed: false, details: "Failed to query" });
			log(`  ✗ ${table}: failed to query`);
			continue;
		}

		if (tableInfo.strategy === "upsert") {
			const passed = actual >= tableInfo.source_total_rows;
			checks.push({
				name: `${table} row count`,
				passed,
				expected: tableInfo.source_total_rows,
				actual,
				details: "upsert: actual >= source total",
			});
			log(
				`  ${passed ? "✓" : "✗"} ${table}: ${actual} rows (expected >= ${tableInfo.source_total_rows})`,
			);
		} else {
			const prodCount = manifest.production_state.tables[table]?.count ?? 0;
			const newRows = tableInfo.source_rows_after_max ?? 0;
			const expectedMin = prodCount + newRows;
			const passed = actual >= expectedMin;
			checks.push({
				name: `${table} row count`,
				passed,
				expected: expectedMin,
				actual,
				details: `incremental: actual >= prod(${prodCount}) + new(${newRows})`,
			});
			log(`  ${passed ? "✓" : "✗"} ${table}: ${actual} rows (expected >= ${expectedMin})`);
		}
	}
	return checks;
}

function verifyMaxIds(manifest: Manifest, dbName: string, cwd: string): VerificationCheck[] {
	const checks: VerificationCheck[] = [];
	for (const table of ["threads", "posts", "attachments"]) {
		const tableInfo = manifest.tables[table];
		if (!tableInfo || tableInfo.prod_max_id === null) continue;

		const result = wranglerQuery(`SELECT MAX(id) as max_id FROM ${table}`, dbName, cwd);
		const actual = parseWranglerScalar(result, "max_id");
		if (actual === null) {
			checks.push({ name: `${table} max_id`, passed: false, details: "Failed to query" });
			continue;
		}
		const passed = actual >= tableInfo.prod_max_id;
		checks.push({ name: `${table} max_id`, passed, expected: tableInfo.prod_max_id, actual });
		log(
			`  ${passed ? "✓" : "✗"} ${table} max_id: ${actual} (expected >= ${tableInfo.prod_max_id})`,
		);
	}
	return checks;
}

function verifyForeignKeys(dbName: string, cwd: string): VerificationCheck[] {
	const checks: VerificationCheck[] = [];
	for (const fk of FK_RELATIONS) {
		const sql = `SELECT COUNT(*) as cnt FROM ${fk.table} WHERE ${fk.col} NOT IN (SELECT ${fk.refCol} FROM ${fk.ref})`;
		const result = wranglerQuery(sql, dbName, cwd);
		const orphans = parseWranglerScalar(result, "cnt");
		if (orphans === null) {
			checks.push({
				name: `FK ${fk.table}.${fk.col} → ${fk.ref}.${fk.refCol}`,
				passed: false,
				details: "Failed to query",
			});
			continue;
		}
		const passed = orphans === 0;
		checks.push({
			name: `FK ${fk.table}.${fk.col} → ${fk.ref}.${fk.refCol}`,
			passed,
			expected: 0,
			actual: orphans,
		});
		log(`  ${passed ? "✓" : "✗"} FK ${fk.table}.${fk.col} → ${fk.ref}: ${orphans} orphans`);
	}
	return checks;
}

function runVerification(manifest: Manifest, dbName: string, cwd: string): VerificationResult {
	log("=== Post-Import Verification ===");
	const checks = [
		...verifyRowCounts(manifest, dbName, cwd),
		...verifyMaxIds(manifest, dbName, cwd),
		...verifyForeignKeys(dbName, cwd),
	];

	const allPassed = checks.every((c) => c.passed);
	log(
		`  Overall: ${allPassed ? "PASSED" : "FAILED"} (${checks.filter((c) => c.passed).length}/${checks.length})`,
	);

	return { verified_at: new Date().toISOString(), checks, passed: allPassed };
}

// ─── Main ───────────────────────────────────────────────────────────────────

log("=== D1 Import Executor ===");
log(`  Manifest: ${MANIFEST_PATH}`);
log(`  Mode: ${DRY_RUN ? "dry-run" : RESUME ? "resume" : "full"}`);

const manifest = loadManifest(MANIFEST_PATH);
const importDir = dirname(MANIFEST_PATH);
const dbName = manifest.production_state.database.name;
const execLogPath = join(importDir, "execution-log.json");
const projectRoot = process.cwd();
const fingerprint = computeManifestFingerprint(manifest);

log(`  Database: ${dbName}`);
log(`  Import dir: ${importDir}`);
log(`  Fingerprint: ${fingerprint}`);

// Validate manifest structure (tables.files ↔ chunks consistency + filename safety)
validateManifestStructure(manifest);

// Validate all chunk files exist in the import directory
const missingFiles = manifest.chunks.filter((c) => !existsSync(join(importDir, c.file)));
if (missingFiles.length > 0) {
	console.error(`Error: ${missingFiles.length} chunk files missing from ${importDir}:`);
	for (const f of missingFiles.slice(0, 10)) {
		console.error(`  - ${f.file}`);
	}
	process.exit(1);
}

// Load existing execution log for resume — validate fingerprint
let completedFiles = new Set<string>();
if (RESUME) {
	const existingLog = loadExecutionLog(execLogPath);
	if (existingLog) {
		if (existingLog.manifest_fingerprint !== fingerprint) {
			console.error(
				`Error: Execution log fingerprint mismatch.\n  Log:      ${existingLog.manifest_fingerprint}\n  Manifest: ${fingerprint}\nThe manifest has changed since the last run. Delete execution-log.json or regenerate the bundle.`,
			);
			process.exit(1);
		}
		const manifestFiles = new Set(manifest.chunks.map((c) => c.file));
		const validDone = existingLog.chunks.filter(
			(c) => c.status === "done" && manifestFiles.has(c.file),
		);
		completedFiles = new Set(validDone.map((c) => c.file));
		log(`  Resuming: ${completedFiles.size} chunks already completed`);
	}
}

// Dry-run mode
if (DRY_RUN) {
	printDryRun(manifest, completedFiles);
	process.exit(0);
}

// Build ordered chunk list from validated manifest
const chunkMap = new Map(manifest.chunks.map((c) => [c.file, c]));
const orderedChunks = IMPORT_TABLE_ORDER.flatMap((table) => {
	const tableInfo = manifest.tables[table];
	if (!tableInfo) return [];
	return tableInfo.files.map((file) => {
		const chunk = chunkMap.get(file);
		return { file, table, rows: chunk?.rows ?? 0, bytes: chunk?.bytes ?? 0 };
	});
});

// Execute
const execLog: ExecutionLog = {
	manifest_path: MANIFEST_PATH,
	manifest_fingerprint: fingerprint,
	database: dbName,
	started_at: new Date().toISOString(),
	chunks: [],
};

// Carry over completed chunks from resume
for (const file of completedFiles) {
	execLog.chunks.push({
		file,
		table: manifest.chunks.find((c) => c.file === file)?.table ?? "unknown",
		status: "done",
		started_at: "",
		finished_at: "",
		duration_ms: 0,
	});
}

log(`\n=== Executing ${orderedChunks.length} chunks against ${dbName} (remote) ===`);

let successCount = 0;
let skipCount = 0;
let failCount = 0;

for (let i = 0; i < orderedChunks.length; i++) {
	const { file, table, rows, bytes } = orderedChunks[i];
	const progress = `[${i + 1}/${orderedChunks.length}]`;

	if (completedFiles.has(file)) {
		log(`  ${progress} SKIP ${file} (already done)`);
		skipCount++;
		continue;
	}

	log(`  ${progress} EXEC ${file} (${table}, ${rows} rows, ${(bytes / 1024).toFixed(1)} KB)`);

	const startedAt = new Date().toISOString();
	const startMs = Date.now();
	const sqlFilePath = resolve(join(importDir, file));
	const result = wranglerExecute(sqlFilePath, dbName, projectRoot);
	const durationMs = Date.now() - startMs;
	const finishedAt = new Date().toISOString();

	const chunkResult: ChunkExecResult = {
		file,
		table,
		status: result.success ? "done" : "failed",
		started_at: startedAt,
		finished_at: finishedAt,
		duration_ms: durationMs,
	};

	if (!result.success) {
		chunkResult.error = result.error?.slice(0, 500);
		failCount++;
		log(`    FAILED in ${durationMs}ms: ${result.error?.slice(0, 200)}`);
	} else {
		successCount++;
		log(`    OK in ${(durationMs / 1000).toFixed(1)}s`);
	}

	execLog.chunks.push(chunkResult);
	saveExecutionLog(execLogPath, execLog);

	if (!result.success) {
		log(`\n  ⚠ Execution stopped at ${file}. Use --resume to continue from this point.`);
		execLog.finished_at = new Date().toISOString();
		saveExecutionLog(execLogPath, execLog);
		process.exit(1);
	}
}

execLog.finished_at = new Date().toISOString();
log("\n=== Execution Complete ===");
log(`  Done: ${successCount}, Skipped: ${skipCount}, Failed: ${failCount}`);

// Post-import verification
log("");
execLog.verification = runVerification(manifest, dbName, projectRoot);
saveExecutionLog(execLogPath, execLog);

if (!execLog.verification.passed) {
	log("\n⚠ Post-import verification FAILED. Check execution-log.json for details.");
	process.exit(1);
}

log("\n✓ Import complete and verified.");
