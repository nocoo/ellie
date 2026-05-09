/**
 * Data integrity verification — row counts and foreign key consistency.
 *
 * Per docs/03-migration.md verification checklist:
 * - Row counts: filtered source vs D1 must match exactly
 * - FK integrity: 0 orphans for all foreign key relationships
 */

import type { Database } from "bun:sqlite";
import { FK_RELATIONS, buildFkCheckQuery } from "../load/d1-sql-builder";

/** Result of a single integrity check. */
export interface CheckResult {
	name: string;
	passed: boolean;
	expected: number | string;
	actual: number | string;
	details?: string;
}

/** Full integrity report. */
export interface IntegrityReport {
	checks: CheckResult[];
	passed: boolean;
	summary: string;
}

/** Row count expectations (from migration stats). */
export interface ExpectedCounts {
	forums: number;
	users: number;
	threads: number;
	posts: number;
	attachments: number;
	checkins: number;
}

/**
 * Verify row counts match expected values.
 */
export function verifyRowCounts(db: Database, expected: ExpectedCounts): CheckResult[] {
	const tables = ["forums", "users", "threads", "posts", "attachments"] as const;
	const results: CheckResult[] = [];

	for (const table of tables) {
		const row = db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
		const actual = row.cnt;
		const exp = expected[table];
		results.push({
			name: `row_count_${table}`,
			passed: actual === exp,
			expected: exp,
			actual,
			details: actual !== exp ? `Difference: ${actual - exp}` : undefined,
		});
	}

	// Checkins: use >= because upsert on incremental runs may have pre-existing rows
	{
		const row = db.query("SELECT COUNT(*) as cnt FROM user_checkins").get() as { cnt: number };
		const actual = row.cnt;
		const exp = expected.checkins;
		results.push({
			name: "row_count_user_checkins",
			passed: actual >= exp,
			expected: `>= ${exp}`,
			actual,
			details: actual < exp ? `Missing ${exp - actual} rows` : undefined,
		});
	}

	return results;
}

/** FK check definition. */
interface FkCheck {
	name: string;
	query: string;
}

/** Generated from canonical FK_RELATIONS — single source of truth. */
const FK_CHECKS: FkCheck[] = FK_RELATIONS.map((fk) => ({
	name: `${fk.table}.${fk.col} → ${fk.ref}.${fk.refCol}`,
	query: buildFkCheckQuery(fk),
}));

/**
 * Verify all foreign key relationships have 0 orphans.
 */
export function verifyForeignKeys(db: Database): CheckResult[] {
	const results: CheckResult[] = [];

	for (const check of FK_CHECKS) {
		const row = db.query(check.query).get() as { cnt: number };
		const orphans = row.cnt;
		results.push({
			name: `fk_${check.name}`,
			passed: orphans === 0,
			expected: 0,
			actual: orphans,
			details: orphans > 0 ? `${orphans} orphan records found` : undefined,
		});
	}

	return results;
}

/**
 * Run full integrity verification.
 */
export function verifyIntegrity(db: Database, expected: ExpectedCounts): IntegrityReport {
	const checks = [...verifyRowCounts(db, expected), ...verifyForeignKeys(db)];

	const passed = checks.every((c) => c.passed);
	const failedCount = checks.filter((c) => !c.passed).length;
	const summary = passed
		? `All ${checks.length} integrity checks passed`
		: `${failedCount}/${checks.length} checks failed`;

	return { checks, passed, summary };
}
