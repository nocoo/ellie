/**
 * Query performance verification — benchmark the 8 query patterns from docs/02-database-schema.md.
 *
 * Per docs/03-migration.md:
 * - Index hit: <10ms
 * - Overall: <50ms
 * - EXPLAIN QUERY PLAN: no SCAN TABLE
 */

import type { Database } from "bun:sqlite";

/** Result of a single query benchmark. */
export interface QueryBenchmark {
	name: string;
	query: string;
	params: (string | number)[];
	durationMs: number;
	usesIndex: boolean;
	explainPlan: string;
	passed: boolean;
}

/** Full performance report. */
export interface PerformanceReport {
	benchmarks: QueryBenchmark[];
	passed: boolean;
	summary: string;
}

/** Threshold in milliseconds for a single query. */
const QUERY_THRESHOLD_MS = 50;

/** Query pattern definition. */
interface QueryPattern {
	name: string;
	query: string;
	/** Function to generate params based on available data in the database. */
	paramsFn: (db: Database) => (string | number)[];
}

/**
 * The 8 query patterns from docs/02-database-schema.md performance targets.
 * Parameters are derived from actual data in the database.
 */
const QUERY_PATTERNS: QueryPattern[] = [
	{
		name: "Thread list by forum (sorted by sticky + last_post_at)",
		query:
			"SELECT * FROM threads WHERE forum_id = ? ORDER BY sticky DESC, last_post_at DESC LIMIT 50",
		paramsFn: (db) => {
			const row = db.query("SELECT id FROM forums LIMIT 1").get() as { id: number } | null;
			return [row?.id ?? 1];
		},
	},
	{
		name: "Post list by thread (sorted by position)",
		query: "SELECT * FROM posts WHERE thread_id = ? ORDER BY position LIMIT 50",
		paramsFn: (db) => {
			const row = db.query("SELECT id FROM threads LIMIT 1").get() as { id: number } | null;
			return [row?.id ?? 1];
		},
	},
	{
		name: "User's threads (sorted by created_at)",
		query: "SELECT * FROM threads WHERE author_id = ? ORDER BY created_at DESC LIMIT 20",
		paramsFn: (db) => {
			const row = db
				.query("SELECT author_id FROM threads GROUP BY author_id ORDER BY COUNT(*) DESC LIMIT 1")
				.get() as { author_id: number } | null;
			return [row?.author_id ?? 1];
		},
	},
	{
		name: "User's posts (sorted by created_at)",
		query: "SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 20",
		paramsFn: (db) => {
			const row = db
				.query("SELECT author_id FROM posts GROUP BY author_id ORDER BY COUNT(*) DESC LIMIT 1")
				.get() as { author_id: number } | null;
			return [row?.author_id ?? 1];
		},
	},
	{
		name: "Latest threads across all forums",
		query: "SELECT * FROM threads ORDER BY last_post_at DESC LIMIT 50",
		paramsFn: () => [],
	},
	{
		name: "Digest threads",
		query: "SELECT * FROM threads WHERE digest > 0 ORDER BY last_post_at DESC LIMIT 50",
		paramsFn: () => [],
	},
	{
		name: "Attachments by post",
		query: "SELECT * FROM attachments WHERE post_id = ?",
		paramsFn: (db) => {
			const row = db.query("SELECT post_id FROM attachments LIMIT 1").get() as {
				post_id: number;
			} | null;
			return [row?.post_id ?? 1];
		},
	},
	{
		name: "Attachments by thread",
		query: "SELECT * FROM attachments WHERE thread_id = ?",
		paramsFn: (db) => {
			const row = db.query("SELECT thread_id FROM attachments LIMIT 1").get() as {
				thread_id: number;
			} | null;
			return [row?.thread_id ?? 1];
		},
	},
];

/**
 * Get the EXPLAIN QUERY PLAN output for a query.
 */
export function getExplainPlan(db: Database, query: string, params: (string | number)[]): string {
	const rows = db.query(`EXPLAIN QUERY PLAN ${query}`).all(...params) as {
		detail: string;
	}[];
	return rows.map((r) => r.detail).join("\n");
}

/**
 * Check if an EXPLAIN QUERY PLAN output uses an index (no SCAN TABLE).
 */
export function usesIndex(explainPlan: string): boolean {
	// "SCAN TABLE" without "USING INDEX" means full table scan
	// "SEARCH TABLE ... USING INDEX" or "USING COVERING INDEX" is good
	const lines = explainPlan.split("\n");
	for (const line of lines) {
		if (line.includes("SCAN TABLE") && !line.includes("USING INDEX")) {
			return false;
		}
	}
	return true;
}

/**
 * Benchmark a single query: execute and measure time + check index usage.
 */
export function benchmarkQuery(
	db: Database,
	name: string,
	query: string,
	params: (string | number)[],
): QueryBenchmark {
	// Get explain plan
	const plan = getExplainPlan(db, query, params);
	const indexUsed = usesIndex(plan);

	// Warm up (run once to prime SQLite page cache)
	db.query(query).all(...params);

	// Benchmark (average of 3 runs)
	const runs = 3;
	let totalMs = 0;
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		db.query(query).all(...params);
		totalMs += performance.now() - start;
	}
	const avgMs = totalMs / runs;

	return {
		name,
		query,
		params,
		durationMs: Math.round(avgMs * 100) / 100,
		usesIndex: indexUsed,
		explainPlan: plan,
		passed: avgMs < QUERY_THRESHOLD_MS && indexUsed,
	};
}

/**
 * Run all 8 query pattern benchmarks.
 */
export function verifyPerformance(db: Database): PerformanceReport {
	const benchmarks: QueryBenchmark[] = [];

	for (const pattern of QUERY_PATTERNS) {
		const params = pattern.paramsFn(db);
		const result = benchmarkQuery(db, pattern.name, pattern.query, params);
		benchmarks.push(result);
	}

	const passed = benchmarks.every((b) => b.passed);
	const failedCount = benchmarks.filter((b) => !b.passed).length;
	const summary = passed
		? `All ${benchmarks.length} query benchmarks passed (<${QUERY_THRESHOLD_MS}ms, index hit)`
		: `${failedCount}/${benchmarks.length} benchmarks failed`;

	return { benchmarks, passed, summary };
}
