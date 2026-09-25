import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { vi } from "vitest";
import { INIT_SQL } from "../../../../src/test-support/init-sql.generated";
import { createMockCtx, makeEnv } from "../../../helpers";

/** Real SQL, strict D1 binding budget, and controllable KV delivery/failure. */
export function readingFixture() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(INIT_SQL);
	const calls: { sql: string; params: SQLInputValue[]; mode: string }[] = [];
	const state = {
		readError: false,
		writeError: false,
		queryError: false,
		writeGate: undefined as Promise<void> | undefined,
		afterRead: undefined as ((sql: string) => Promise<void>) | undefined,
		beforeWrite: undefined as ((sql: string) => Promise<void>) | undefined,
	};
	function statement(sql: string, params: SQLInputValue[] = []) {
		const record = (mode: string) => calls.push({ sql, params, mode });
		return {
			__sql: sql,
			bind: (...values: SQLInputValue[]) => {
				if (values.length > 100) throw new Error("D1_ERROR: too many SQL variables");
				return statement(sql, values);
			},
			first: async () => {
				record("first");
				const row = sqlite.prepare(sql).get(...params) ?? null;
				await state.afterRead?.(sql);
				return row;
			},
			all: async () => {
				record("all");
				if (state.queryError) return { success: false, results: [], meta: {} };
				if (!/^\s*SELECT\b/i.test(sql)) await state.beforeWrite?.(sql);
				const results = sqlite.prepare(sql).all(...params);
				await state.afterRead?.(sql);
				return { success: true, results, meta: {} };
			},
			run: async () => {
				record("run");
				if (state.beforeWrite) await state.beforeWrite(sql);
				const result = sqlite.prepare(sql).run(...params);
				return {
					success: true,
					results: [],
					meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
				};
			},
		};
	}
	const db = {
		prepare: statement,
		batch: async (statements: ReturnType<typeof statement>[]) => {
			const result = [];
			for (const stmt of statements)
				result.push(/^\s*SELECT\b/i.test(stmt.__sql) ? await stmt.all() : await stmt.run());
			return result;
		},
	} as unknown as D1Database;
	const values = new Map<string, string>();
	const read = (key: string, type?: string) => {
		const raw = values.get(key) ?? null;
		return type === "json" && raw !== null ? JSON.parse(raw) : raw;
	};
	const kv = {
		list: vi.fn(async (options: KVNamespaceListOptions = {}) => {
			if (state.readError) throw new Error("KV unavailable");
			const keys = [...values.keys()].filter((key) => key.startsWith(options.prefix ?? "")).sort();
			const offset = Number(options.cursor ?? 0);
			const end = offset + (options.limit ?? 1000);
			const selected = keys.slice(offset, end).map((name) => ({ name }));
			return end >= keys.length
				? { keys: selected, list_complete: true, cacheStatus: null }
				: { keys: selected, list_complete: false, cursor: String(end), cacheStatus: null };
		}),
		get: vi.fn(async (key: string | string[], type?: string) => {
			if (state.readError) throw new Error("KV unavailable");
			if (Array.isArray(key)) {
				if (key.length > 100) throw new Error("KV bulk read exceeds 100 keys");
				return new Map(key.map((k) => [k, read(k, type)]));
			}
			return read(key, type);
		}),
		put: vi.fn(async (key: string, value: string, _options?: KVNamespacePutOptions) => {
			await state.writeGate;
			if (state.writeError) throw new Error("KV 429");
			values.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			values.delete(key);
		}),
	} as unknown as KVNamespace;
	const env = makeEnv({ DB: db, KV: kv, USE_KV_USER_CACHE: "true" });
	const ctx = createMockCtx();
	function insert(table: string, row: Record<string, SQLInputValue>) {
		const fields = Object.keys(row);
		sqlite
			.prepare(
				`INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
			)
			.run(...Object.values(row));
	}
	for (const [id, name, role] of [
		[10, "alice", 0],
		[20, "bob", 0],
		[30, "mod", 3],
		[1, "admin", 1],
		[2, "super", 2],
	] as const) {
		insert("users", {
			id,
			username: name,
			role,
			email_verified_at: 1,
			avatar: `${name}.png`,
			avatar_path: `${name}.jpg`,
		});
	}
	insert("forums", { id: 1, name: "Public", visibility: "public", moderator_ids: "30" });
	insert("forums", { id: 2, name: "Staff", visibility: "staff" });
	insert("forums", { id: 3, name: "Paused", status: 0, visibility: "public" });
	function thread(id: number, overrides: Record<string, SQLInputValue> = {}) {
		insert("threads", {
			id,
			forum_id: 1,
			author_id: 10,
			author_name: "alice",
			subject: `Thread ${id}`,
			created_at: id,
			last_post_at: id,
			last_poster_id: 20,
			last_poster: "bob",
			...overrides,
		});
	}
	function post(id: number, overrides: Record<string, SQLInputValue> = {}) {
		insert("posts", {
			id,
			thread_id: 1,
			forum_id: 1,
			author_id: 10,
			author_name: "alice",
			content: `Body ${id}`,
			position: id,
			created_at: id,
			is_first: id === 1 ? 1 : 0,
			...overrides,
		});
	}
	function snapshots(family: string) {
		return [...values.entries()]
			.filter(([key]) => key.startsWith(`cache:v3:${family}:`))
			.map(([key, value]) => ({ key, ...JSON.parse(value) }));
	}
	return {
		env,
		ctx,
		sqlite,
		calls,
		values,
		state,
		insert,
		thread,
		post,
		snapshots,
		close: () => sqlite.close(),
	};
}

export function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
