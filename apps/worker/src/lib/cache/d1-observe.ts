import { recordKvOp } from "./metrics";

function extractFirst(result: D1Result, column?: string): unknown {
	if (!result.success) {
		throw new Error((result as { error?: string }).error ?? "D1_ERROR: query execution failed");
	}
	const results = result.results;
	if (!Array.isArray(results)) throw new Error("D1_ERROR: malformed query result");
	if (results.length === 0) return null;
	const firstRow = results[0];
	if (column !== undefined) {
		if (
			typeof firstRow !== "object" ||
			!firstRow ||
			(firstRow as Record<string, unknown>)[column] === undefined
		) {
			throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`, {
				cause: new Error("Column not found"),
			});
		}
		return (firstRow as Record<string, unknown>)[column];
	}
	return firstRow;
}

/**
 * Observes each existing SQL call once; no extra queries; never retains SQL/bind values.
 * Note: D1 .raw() does not expose metadata in the public API; raw calls are measured for
 * query count and duration only without row counts.
 */
export function observeD1(db: D1Database, source: "business" | "admin"): D1Database {
	const family = source === "admin" ? "admin:d1" : "application:d1";
	const originals = new WeakMap<
		D1PreparedStatement,
		{ statement: D1PreparedStatement; observed: boolean }
	>();
	const measured = async <T>(
		run: () => Promise<T>,
		queries = 1,
		included?: boolean[],
	): Promise<T> => {
		const started = Date.now();
		recordKvOp(family, "d1-query", queries);
		try {
			const result = await run();
			for (const [index, item] of (Array.isArray(result) ? result : [result]).entries()) {
				if (included && !included[index]) continue;
				if (typeof item !== "object" || !item || !("meta" in item)) continue;
				const meta = item.meta as Partial<D1Meta> | null;
				if (typeof meta?.rows_read === "number") recordKvOp(family, "d1-rows-read", meta.rows_read);
				if (typeof meta?.rows_written === "number")
					recordKvOp(family, "d1-rows-written", meta.rows_written);
			}
			return result;
		} finally {
			recordKvOp(family, "d1-duration-ms", Date.now() - started);
		}
	};
	const wrap = (statement: D1PreparedStatement, observed = true): D1PreparedStatement => {
		const wrapped = new Proxy(statement, {
			get(target, property) {
				if (property === "bind")
					return (...params: unknown[]) => wrap(target.bind(...params), observed);
				const method = Reflect.get(target, property);
				if (typeof method !== "function") return method;
				if (observed) {
					if (property === "all" || property === "run" || property === "raw") {
						return (...args: unknown[]) => measured(() => method.apply(target, args));
					}
					if (property === "first") {
						return async (column?: string) => {
							const res = await measured(() => target.all());
							return extractFirst(res, column);
						};
					}
				}
				return method.bind(target);
			},
		});
		originals.set(wrapped, { statement, observed });
		return wrapped;
	};
	return new Proxy(db, {
		get(target, property) {
			if (property === "prepare")
				return (sql: string) => {
					const statement = target.prepare(sql);
					// Instrumentation does not recursively instrument its own storage.
					return wrap(statement, !sql.includes("kv_cache_metrics_minute"));
				};
			if (property === "batch")
				return (statements: D1PreparedStatement[]) => {
					const entries = statements.map(
						(statement) => originals.get(statement) ?? { statement, observed: true },
					);
					const count = entries.filter((entry) => entry.observed).length;
					const run = () => target.batch(entries.map((entry) => entry.statement));
					return count
						? measured(
								run,
								count,
								entries.map((entry) => entry.observed),
							)
						: run();
				};
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
