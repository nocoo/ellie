/**
 * d1-shim — minimal D1Database adapter on top of bun:sqlite.
 *
 * Used by L2-fast (in-process Worker over `:memory:` SQLite). Produces
 * the subset of the D1 binding API that Ellie's handlers actually use:
 * `prepare()`, `bind()`, `first()`, `all()`, `run()`, `raw()`, plus
 * `batch()` and `exec()` on the database itself.
 *
 * `batch()` dispatches per statement: SELECT-shaped statements run via
 * sqlite `.all()` and produce `{ results: rows[] }`; everything else
 * runs via `.run()` and produces `{ results: [], meta }`. This matches
 * D1's real behavior — `results[i].results` is always present.
 *
 * Not implemented (any handler relying on these must run under L2-http):
 *   - withSession (read replication)
 *   - dump
 *   - meta.size_after / meta.rows_read / meta.rows_written
 *
 * bun:sqlite is synchronous; we wrap calls in `async` to match D1.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
	D1Database,
	D1ExecResult,
	D1PreparedStatement,
	D1Result,
} from "@cloudflare/workers-types";

/** SELECT / WITH / EXPLAIN, or any statement with RETURNING, is "read-shaped". */
export function isReadStatement(sql: string): boolean {
	const trimmed = sql.trim().toUpperCase();
	if (/^(SELECT|WITH|EXPLAIN)\b/.test(trimmed)) return true;
	return /\bRETURNING\b/.test(trimmed);
}

interface InternalStatement extends D1PreparedStatement {
	__sql: string;
	__isRead: boolean;
	__executeSync: () => D1Result;
}

function makeStatement(sqlite: Database, sql: string, bound: unknown[]): InternalStatement {
	const isRead = isReadStatement(sql);
	const stmt: Partial<InternalStatement> = {};
	const args = bound as SQLQueryBindings[];

	stmt.__sql = sql;
	stmt.__isRead = isRead;

	stmt.bind = (...newArgs: unknown[]) => {
		// Match production D1, rather than bun:sqlite's much larger limit.
		if (newArgs.length > 100) throw new Error("D1_ERROR: too many SQL variables");
		return makeStatement(sqlite, sql, newArgs);
	};

	stmt.first = (async <T = unknown>(col?: string) => {
		const row = sqlite.prepare(sql).get(...args) as Record<string, unknown> | null | undefined;
		if (row === undefined || row === null) return null;
		if (col === undefined) return row as T;
		return (row[col] as T) ?? null;
	}) as InternalStatement["first"];

	const allSync = <T = unknown>(): D1Result<T> => {
		const results = sqlite.prepare(sql).all(...args) as T[];
		return {
			success: true,
			meta: emptyMeta(),
			results,
		};
	};
	stmt.all = (async <T = unknown>() => allSync<T>()) as InternalStatement["all"];

	const runSync = <T = unknown>() => {
		const r = sqlite.prepare(sql).run(...args);
		return {
			success: true,
			results: [] as T[],
			meta: {
				...emptyMeta(),
				changes: r.changes,
				last_row_id: Number(r.lastInsertRowid),
			},
		} as D1Result<T>;
	};
	stmt.run = (async <T = unknown>() => runSync<T>()) as InternalStatement["run"];
	stmt.__executeSync = () => (isRead ? allSync() : runSync());

	stmt.raw = (async () => {
		return sqlite.prepare(sql).values(...args) as unknown[][];
	}) as InternalStatement["raw"];

	return stmt as InternalStatement;
}

function emptyMeta() {
	return {
		duration: 0,
		size_after: 0,
		rows_read: 0,
		rows_written: 0,
		last_row_id: 0,
		changed_db: false,
		changes: 0,
		served_by: "d1-shim",
		served_by_region: "test",
		served_by_primary: true,
		timings: { sql_duration_ms: 0 },
	} as D1Result["meta"];
}

/**
 * Wrap a bun:sqlite `Database` as a D1Database for the in-process Worker.
 * The schema must already be applied to `sqlite` (via `db.exec(INIT_SQL)`)
 * before any handler is invoked.
 */
export function wrapAsD1(sqlite: Database): D1Database {
	const prepare = (sql: string): D1PreparedStatement => makeStatement(sqlite, sql, []);

	const batch = async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
		// Run synchronously in one SQLite transaction. A failure at any point
		// must roll back earlier statements, just like a real D1 batch.
		return sqlite.transaction(() =>
			statements.map((s) => (s as InternalStatement).__executeSync() as D1Result<T>),
		)();
	};

	const exec = async (sql: string): Promise<D1ExecResult> => {
		sqlite.exec(sql);
		return { count: 0, duration: 0 };
	};

	const dump = async (): Promise<ArrayBuffer> => {
		throw new Error("d1-shim: dump() not supported. Use L2-http for D1 dump tests.");
	};

	return {
		prepare,
		batch,
		exec,
		dump,
	} as unknown as D1Database;
}
