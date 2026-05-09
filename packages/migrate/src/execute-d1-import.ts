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
 *   - Mark-done: safely marks a verified failed chunk as done in execution-log.json
 *     (validates fingerprint, requires status=failed, records audit fields)
 *   - Verify-warning-success: when wrangler exits non-zero with only a WARNING
 *     (no ERROR), automatically verifies data via PK count + field sampling
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
 *
 *   bun run packages/migrate/src/execute-d1-import.ts \
 *     --manifest output/d1-import-2026-05-09/manifest.json \
 *     --mark-done users-035.sql
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ChunkInfo, Manifest } from "./load/d1-sql-builder";
import {
	FK_RELATIONS,
	IMPORT_TABLE_ORDER,
	computeManifestFingerprint,
	isRetryableUploadFailure,
	isWarningOnly,
	validateManifestStructure,
} from "./load/d1-sql-builder";

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		manifest: { type: "string" },
		"dry-run": { type: "boolean", default: false },
		resume: { type: "boolean", default: false },
		"mark-done": { type: "string" },
		"verify-warning-success": { type: "boolean", default: false },
		"source-db": { type: "string" },
	},
});

const MANIFEST_PATH = values.manifest ?? "output/d1-import-2026-05-09/manifest.json";
const DRY_RUN = values["dry-run"] ?? false;
const RESUME = values.resume ?? false;
const MARK_DONE = values["mark-done"];
const VERIFY_WARNING = values["verify-warning-success"] ?? false;
const SOURCE_DB = values["source-db"];
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
	manually_verified_at?: string;
	reason?: string;
	warning_verified_at?: string;
	warning_verification?: {
		mode: "pk_count_and_sample";
		pk_count: { expected: number; actual: number };
		samples: Array<{
			id: number;
			fields_checked: string[];
			passed: boolean;
		}>;
	};
	/** Number of fetch-failure retries before final result (0 = first attempt succeeded). */
	retry_attempts?: number;
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
): { success: boolean; error?: string; stderr?: string } {
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
		const stderr = err.stderr || err.message || "Unknown error";
		return { success: false, error: stderr, stderr };
	}
}

// ─── Fetch-failure retry ──────────────────────────────────────────────────

/** Maximum retries for transient network failures (fetch failed). */
const MAX_FETCH_RETRIES = 3;

/** Base delay between retries in ms — doubles each attempt (5s, 10s, 20s). */
const RETRY_BASE_DELAY_MS = Number(process.env.EXECUTOR_RETRY_BASE_DELAY_MS ?? "5000");

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Execute a wrangler command with bounded retry for transient fetch failures.
 * Retries up to MAX_FETCH_RETRIES times with exponential backoff.
 * Returns the final result — either success or the last failure.
 */
function wranglerExecuteWithRetry(
	sqlFile: string,
	dbName: string,
	cwd: string,
	logFn: (msg: string) => void,
): { success: boolean; error?: string; stderr?: string; retries: number } {
	let lastResult = wranglerExecute(sqlFile, dbName, cwd);
	if (lastResult.success) return { ...lastResult, retries: 0 };

	for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
		if (!isRetryableUploadFailure(lastResult.stderr ?? "")) {
			// Not a fetch failure — don't retry (SQL error, etc.)
			return { ...lastResult, retries: attempt - 1 };
		}

		const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
		logFn(
			`    RETRY ${attempt}/${MAX_FETCH_RETRIES} after upload failure (waiting ${delayMs / 1000}s)...`,
		);
		sleepSync(delayMs);

		lastResult = wranglerExecute(sqlFile, dbName, cwd);
		if (lastResult.success) {
			logFn(`    RETRY ${attempt} succeeded`);
			return { ...lastResult, retries: attempt };
		}
	}

	return { ...lastResult, retries: MAX_FETCH_RETRIES };
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

// ─── Warning verification ──────────────────────────────────────────────────

/** Source-owned fields to sample-check per table for warning verification. */
const SAMPLE_FIELDS: Record<string, string[]> = {
	users: ["username", "coins", "has_avatar", "campus"],
	forums: ["name", "description", "display_order"],
	threads: ["subject", "author_name", "forum_id"],
	posts: ["content", "author_name", "thread_id"],
	attachments: ["filename", "file_size", "is_image"],
	user_checkins: ["user_id"],
};

/** PK column per table (matches generator's conflict column). */
function pkColumn(table: string): string {
	return table === "user_checkins" ? "user_id" : "id";
}

/**
 * Pick first, middle, last IDs from a pk_list for sample verification.
 */
function pickSampleIds(pkList: number[]): number[] {
	if (pkList.length === 0) return [];
	if (pkList.length === 1) return [pkList[0]];
	if (pkList.length === 2) return [pkList[0], pkList[pkList.length - 1]];
	const mid = Math.floor(pkList.length / 2);
	return [pkList[0], pkList[mid], pkList[pkList.length - 1]];
}

/**
 * Verify a warning chunk by checking PK count and sampling fields against source DB.
 * Returns verification result with audit data, or null if verification fails.
 */
function verifyWarningChunk(
	chunk: ChunkInfo,
	dbName: string,
	cwd: string,
	sourceDbPath: string,
): {
	passed: boolean;
	verification: NonNullable<ChunkExecResult["warning_verification"]>;
} {
	const pk = pkColumn(chunk.table);
	const pkList = chunk.pk_list;

	// 1. PK count check: SELECT COUNT(*) FROM table WHERE id IN (...)
	const inClause = pkList.join(",");
	const countSql = `SELECT COUNT(*) as cnt FROM ${chunk.table} WHERE ${pk} IN (${inClause})`;
	const countResult = wranglerQuery(countSql, dbName, cwd);
	const actualCount = parseWranglerScalar(countResult, "cnt");

	const pkCountResult = {
		expected: pkList.length,
		actual: actualCount ?? 0,
	};

	const pkPassed = actualCount === pkList.length;

	// 2. Sample field checks — required for tables with sample fields
	const sampleIds = pickSampleIds(pkList);
	const fields = SAMPLE_FIELDS[chunk.table] ?? [];
	const samples: NonNullable<ChunkExecResult["warning_verification"]>["samples"] = [];

	if (pkPassed && fields.length > 0) {
		for (const sampleId of sampleIds) {
			const selectFields = fields.join(",");
			// Read expected from source DB via subprocess — path safely injected
			const safeDbPath = JSON.stringify(sourceDbPath);
			const expectedJson = (() => {
				try {
					return execFileSync(
						"bun",
						[
							"-e",
							`import{Database}from"bun:sqlite";const db=new Database(${safeDbPath},{readonly:true});const r=db.query("SELECT ${selectFields} FROM ${chunk.table} WHERE ${pk}=${sampleId}").get();console.log(JSON.stringify(r));`,
						],
						{ encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] },
					);
				} catch {
					return null;
				}
			})();

			if (!expectedJson) {
				samples.push({ id: sampleId, fields_checked: fields, passed: false });
				continue;
			}

			const expected = JSON.parse(expectedJson.trim()) as Record<string, unknown> | null;
			if (!expected) {
				samples.push({ id: sampleId, fields_checked: fields, passed: false });
				continue;
			}

			// Read actual from remote D1
			const remoteSql = `SELECT ${selectFields} FROM ${chunk.table} WHERE ${pk}=${sampleId}`;
			const remoteResult = wranglerQuery(remoteSql, dbName, cwd);
			let actual: Record<string, unknown> | null = null;
			try {
				const parsed = JSON.parse(remoteResult);
				actual = parsed[0]?.results?.[0] ?? parsed[0]?.result?.[0] ?? parsed?.results?.[0] ?? null;
			} catch {
				actual = null;
			}

			if (!actual) {
				samples.push({ id: sampleId, fields_checked: fields, passed: false });
				continue;
			}

			const fieldsPassed = fields.every(
				(f) => String(expected[f] ?? "") === String(actual[f] ?? ""),
			);
			samples.push({ id: sampleId, fields_checked: fields, passed: fieldsPassed });
		}
	}

	// Enforce: tables with sample fields must have non-empty samples
	const requiresSamples = fields.length > 0;
	const samplesPassed = requiresSamples
		? samples.length > 0 && samples.every((s) => s.passed)
		: true;
	const passed = pkPassed && samplesPassed;

	return {
		passed,
		verification: {
			mode: "pk_count_and_sample",
			pk_count: pkCountResult,
			samples,
		},
	};
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
			// Windowed/canary upserts (continuation_max_id set) only cover a
			// subset of the table. Don't compare against source_total_rows;
			// instead verify that remote count >= production baseline.
			const isWindowed = tableInfo.continuation_max_id != null;
			if (isWindowed) {
				const prodCount = manifest.production_state.tables[table]?.count ?? 0;
				const passed = actual >= prodCount;
				checks.push({
					name: `${table} row count`,
					passed,
					expected: prodCount,
					actual,
					details: "windowed upsert: actual >= production baseline",
				});
				log(
					`  ${passed ? "✓" : "✗"} ${table}: ${actual} rows (expected >= ${prodCount}, windowed canary)`,
				);
			} else {
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
			}
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
log(
	`  Mode: ${DRY_RUN ? "dry-run" : RESUME ? "resume" : MARK_DONE ? "mark-done" : "full"}${VERIFY_WARNING ? " +verify-warning" : ""}`,
);

const manifest = loadManifest(MANIFEST_PATH);
const importDir = dirname(MANIFEST_PATH);
const dbName = manifest.production_state.database.name;
const execLogPath = join(importDir, "execution-log.json");
const projectRoot = process.cwd();
const fingerprint = computeManifestFingerprint(manifest);

// Resolve source DB for warning verification — required when --verify-warning-success is on
const resolvedSourceDb = SOURCE_DB ?? manifest.source_db;
if (VERIFY_WARNING && !DRY_RUN && !MARK_DONE) {
	if (!resolvedSourceDb) {
		console.error(
			"Error: --verify-warning-success requires a source DB. Provide --source-db or ensure manifest.source_db exists.",
		);
		process.exit(1);
	}
	if (!existsSync(resolvedSourceDb)) {
		console.error(
			`Error: Source DB not found: ${resolvedSourceDb}\nProvide --source-db with a valid path to the dry-run SQLite database.`,
		);
		process.exit(1);
	}
	log(`  Source DB: ${resolvedSourceDb}`);
}

log(`  Database: ${dbName}`);
log(`  Import dir: ${importDir}`);
log(`  Fingerprint: ${fingerprint}`);

// Validate manifest structure (tables.files ↔ chunks consistency + filename safety)
validateManifestStructure(manifest);

// ─── Mark-done mode ────────────────────────────────────────────────────────

if (MARK_DONE) {
	const existingLog = loadExecutionLog(execLogPath);
	if (!existingLog) {
		console.error("Error: No execution-log.json found. Nothing to mark done.");
		process.exit(1);
	}

	if (existingLog.manifest_fingerprint !== fingerprint) {
		console.error(
			`Error: Execution log fingerprint mismatch.\n  Log:      ${existingLog.manifest_fingerprint}\n  Manifest: ${fingerprint}\nThe manifest has changed since the last run. Delete execution-log.json or regenerate the bundle.`,
		);
		process.exit(1);
	}

	if (!manifest.chunks.some((c) => c.file === MARK_DONE)) {
		console.error(`Error: "${MARK_DONE}" is not a chunk in the manifest.`);
		process.exit(1);
	}

	const chunkIdx = existingLog.chunks.findIndex((c) => c.file === MARK_DONE);
	if (chunkIdx === -1) {
		console.error(`Error: "${MARK_DONE}" not found in execution log.`);
		process.exit(1);
	}

	const chunk = existingLog.chunks[chunkIdx];
	if (chunk.status !== "failed") {
		console.error(
			`Error: "${MARK_DONE}" has status "${chunk.status}", not "failed". Only failed chunks can be marked done.`,
		);
		process.exit(1);
	}

	existingLog.chunks[chunkIdx] = {
		...chunk,
		status: "done",
		error: undefined,
		manually_verified_at: new Date().toISOString(),
		reason: "manually verified: data confirmed present in remote D1",
	};

	saveExecutionLog(execLogPath, existingLog);
	log(`  Marked "${MARK_DONE}" as done (manually verified).`);
	process.exit(0);
}

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
let preservedChunks: ChunkExecResult[] = [];
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
		preservedChunks = validDone;
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

// Carry over completed chunks from resume — preserve original entries
for (const preserved of preservedChunks) {
	execLog.chunks.push(preserved);
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
	const result = wranglerExecuteWithRetry(sqlFilePath, dbName, projectRoot, log);
	const durationMs = Date.now() - startMs;
	const finishedAt = new Date().toISOString();

	const chunkResult: ChunkExecResult = {
		file,
		table,
		status: result.success ? "done" : "failed",
		started_at: startedAt,
		finished_at: finishedAt,
		duration_ms: durationMs,
		retry_attempts: result.retries > 0 ? result.retries : undefined,
	};

	if (!result.success) {
		// Check if this is a warning-only failure that can be verified
		if (VERIFY_WARNING && result.stderr && isWarningOnly(result.stderr)) {
			log(`    WARNING-only exit (${durationMs}ms), verifying...`);
			const chunkMeta = chunkMap.get(file);
			if (chunkMeta) {
				const verification = verifyWarningChunk(chunkMeta, dbName, projectRoot, resolvedSourceDb);
				if (verification.passed) {
					chunkResult.status = "done";
					chunkResult.error = undefined;
					chunkResult.warning_verified_at = new Date().toISOString();
					chunkResult.warning_verification = verification.verification;
					successCount++;
					log(
						`    VERIFIED OK: ${verification.verification.pk_count.actual}/${verification.verification.pk_count.expected} PKs, ${verification.verification.samples.length} samples passed`,
					);
				} else {
					chunkResult.error = result.error?.slice(0, 500);
					chunkResult.warning_verification = verification.verification;
					failCount++;
					log(
						`    VERIFICATION FAILED: PK ${verification.verification.pk_count.actual}/${verification.verification.pk_count.expected}`,
					);
				}
			} else {
				chunkResult.error = result.error?.slice(0, 500);
				failCount++;
				log(`    FAILED in ${durationMs}ms: ${result.error?.slice(0, 200)}`);
			}
		} else {
			chunkResult.error = result.error?.slice(0, 500);
			failCount++;
			log(`    FAILED in ${durationMs}ms: ${result.error?.slice(0, 200)}`);
		}
	} else {
		successCount++;
		log(`    OK in ${(durationMs / 1000).toFixed(1)}s`);
	}

	execLog.chunks.push(chunkResult);
	saveExecutionLog(execLogPath, execLog);

	if (chunkResult.status === "failed") {
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
