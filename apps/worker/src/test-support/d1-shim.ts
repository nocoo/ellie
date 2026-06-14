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
}

function makeStatement(sqlite: Database, sql: string, bound: unknown[]): InternalStatement {
	const isRead = isReadStatement(sql);
	const stmt: Partial<InternalStatement> = {};
	const args = bound as SQLQueryBindings[];

	stmt.__sql = sql;
	stmt.__isRead = isRead;

	stmt.bind = (...newArgs: unknown[]) => {
		return makeStatement(sqlite, sql, newArgs);
	};

	stmt.first = (async <T = unknown>(col?: string) => {
		const row = sqlite.prepare(sql).get(...args) as Record<string, unknown> | null | undefined;
		if (row === undefined || row === null) return null;
		if (col === undefined) return row as T;
		return (row[col] as T) ?? null;
	}) as InternalStatement["first"];

	stmt.all = (async <T = unknown>() => {
		const results = sqlite.prepare(sql).all(...args) as T[];
		return {
			success: true,
			meta: emptyMeta(),
			results,
		};
	}) as InternalStatement["all"];

	stmt.run = (async <T = unknown>() => {
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
	}) as InternalStatement["run"];

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
		const out: D1Result<T>[] = [];
		for (const s of statements) {
			const internal = s as Partial<InternalStatement> & D1PreparedStatement;
			const isRead =
				internal.__isRead === true ||
				(typeof internal.__sql === "string" && isReadStatement(internal.__sql));
			if (isRead) {
				out.push((await s.all<T>()) as D1Result<T>);
			} else {
				out.push((await s.run<T>()) as D1Result<T>);
			}
		}
		return out;
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
