/**
 * Microbenchmark for worker list-loading hot path.
 *
 * Exercises the actual handlers (apps/worker/src/handlers/forum.ts and
 * apps/worker/src/handlers/thread.ts) against a hand-rolled in-memory mock of
 * `D1Database`. Goal: reproduce the work of a typical list request many times,
 * so optimisations show up clearly above noise.
 *
 * IMPORTANT: this script exists to track regressions/improvements on real
 * handler code. Do NOT change it just to make a number go down. If the bench
 * needs to evolve (e.g. cover more endpoints), the scope of work per iteration
 * must stay representative, and the change must be documented.
 */
import { list as forumList } from "../apps/worker/src/handlers/forum";
import { list as threadList } from "../apps/worker/src/handlers/thread";

// -------------------------------------------------------------------------
// Dataset (fixed seed-ish)
// -------------------------------------------------------------------------

const FORUM_COUNT = 30;
const THREADS_PER_FORUM = 80; // size returned by list query under typical load

function makeForumRows(n: number) {
	const out: Record<string, unknown>[] = [];
	for (let i = 1; i <= n; i++) {
		out.push({
			id: i,
			parent_id: i > 5 ? ((i - 1) % 5) + 1 : 0,
			name: `Forum ${i}`,
			description: `Description for forum number ${i}`,
			icon: i % 3 === 0 ? "icon.png" : "",
			display_order: i,
			threads: 100 + i * 7,
			posts: 1000 + i * 53,
			type: "forum",
			status: 1,
			visibility: "public",
			moderators: i % 4 === 0 ? "alice,bob" : "",
			moderator_ids: i % 4 === 0 ? "10,11" : "",
			last_thread_id: i * 10,
			last_post_at: 1_700_000_000 + i * 60,
			last_poster: `user${(i % 7) + 1}`,
			last_poster_id: ((i * 3) % 13) + 1,
			last_thread_subject: `Latest thread in forum ${i}`,
			last_poster_avatar: "",
			last_poster_avatar_path: "",
		});
	}
	return out;
}

function makeTodayCountRows(n: number) {
	const out: { forum_id: number; cnt: number }[] = [];
	for (let i = 1; i <= n; i++) {
		if (i % 2 === 0) out.push({ forum_id: i, cnt: (i % 13) + 1 });
	}
	return out;
}

function makeVisibleLastThreadRows(n: number) {
	const out: Record<string, unknown>[] = [];
	for (let i = 1; i <= n; i++) {
		out.push({
			forum_id: i,
			thread_id: i * 10,
			subject: `Latest thread in forum ${i}`,
			last_post_at: 1_700_000_000 + i * 60,
			last_poster_id: ((i * 3) % 13) + 1,
			last_poster: `user${(i % 7) + 1}`,
		});
	}
	return out;
}

function makeThreadRows(forumId: number, n: number) {
	const out: Record<string, unknown>[] = [];
	for (let i = 1; i <= n; i++) {
		out.push({
			id: forumId * 1000 + i,
			forum_id: forumId,
			author_id: ((i * 7) % 23) + 1,
			author_name: `author${(i % 11) + 1}`,
			subject: `Thread ${i} in forum ${forumId} — a representative subject string`,
			created_at: 1_700_000_000 + i * 30,
			last_post_at: 1_700_000_500 + i * 30,
			last_poster: `lp${(i % 9) + 1}`,
			last_poster_id: ((i * 11) % 19) + 1,
			replies: i % 50,
			views: i * 13,
			closed: 0,
			sticky: i <= 2 ? 1 : 0,
			digest: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
			type_name: "",
			author_avatar: "",
			author_avatar_path: "",
			last_poster_avatar: "",
			last_poster_avatar_path: "",
		});
	}
	return out;
}

const FORUM_ROWS = makeForumRows(FORUM_COUNT);
const COUNT_ROWS = makeTodayCountRows(FORUM_COUNT);
const VISIBLE_LAST_ROWS = makeVisibleLastThreadRows(FORUM_COUNT);
const THREAD_ROWS_BY_FORUM = new Map<number, Record<string, unknown>[]>();
for (let i = 1; i <= FORUM_COUNT; i++) {
	THREAD_ROWS_BY_FORUM.set(i, makeThreadRows(i, THREADS_PER_FORUM));
}

// -------------------------------------------------------------------------
// Mock D1
// -------------------------------------------------------------------------

function makeForumListDb(): D1Database {
	const stmt = (results: unknown[], firstVal?: unknown) => {
		const ret = {
			bind: (..._args: unknown[]) => ret,
			all: async () => ({ results }),
			first: async () => firstVal ?? null,
		};
		return ret as unknown as D1PreparedStatement;
	};

	return {
		prepare(sql: string) {
			if (sql.includes("FROM users WHERE id IN")) {
				// moderator names lookup — return matching rows
				return {
					bind: (...ids: unknown[]) => ({
						all: async () => ({
							results: (ids as number[]).map((id) => ({ id, username: `user${id}` })),
						}),
					}),
				} as unknown as D1PreparedStatement;
			}
			if (sql.includes("FROM forums") && !sql.includes("FROM threads")) {
				return stmt(FORUM_ROWS);
			}
			if (sql.includes("MAX(last_post_at)") && sql.includes("FROM threads")) {
				return stmt(VISIBLE_LAST_ROWS);
			}
			if (sql.includes("FROM threads") && sql.includes("created_at >= ?")) {
				return stmt(COUNT_ROWS);
			}
			// avatar enrichment fallback
			if (sql.includes("avatar") && sql.includes("FROM users")) {
				return stmt([]);
			}
			return stmt([]);
		},
	} as unknown as D1Database;
}

function makeThreadListDb(forumId: number): D1Database {
	const rows = THREAD_ROWS_BY_FORUM.get(forumId) ?? [];
	const stmt = (results: unknown[], firstVal?: unknown) => {
		const ret = {
			bind: (..._args: unknown[]) => ret,
			all: async () => ({ results }),
			first: async () => firstVal ?? null,
		};
		return ret as unknown as D1PreparedStatement;
	};

	return {
		prepare(sql: string) {
			if (sql.includes("SELECT status, visibility FROM forums")) {
				return stmt([], { status: 1, visibility: "public" });
			}
			if (sql.includes("FROM threads")) {
				if (sql.includes("COUNT(")) {
					return stmt([], { total: rows.length });
				}
				return stmt(rows);
			}
			return stmt([]);
		},
	} as unknown as D1Database;
}

// -------------------------------------------------------------------------
// Env / ctx
// -------------------------------------------------------------------------

function makeKv(): KVNamespace {
	const m = new Map<string, string>();
	return {
		async get(k: string) {
			return m.get(k) ?? null;
		},
		async put(k: string, v: string) {
			m.set(k, v);
		},
		async delete(k: string) {
			m.delete(k);
		},
		async getWithMetadata(k: string) {
			return { value: m.get(k) ?? null, metadata: null };
		},
	} as unknown as KVNamespace;
}

function makeEnv(db: D1Database) {
	return {
		API_KEY: "test",
		ADMIN_API_KEY: "test-admin",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET: "secret",
		KV: makeKv(),
		R2: {} as unknown as R2Bucket,
		USE_KV_USER_CACHE: "false",
		// biome-ignore lint/suspicious/noExplicitAny: bench harness partial env mock
	} as any;
}

const ctx: ExecutionContext = {
	waitUntil: () => {},
	passThroughOnException: () => {},
} as unknown as ExecutionContext;

// -------------------------------------------------------------------------
// Run
// -------------------------------------------------------------------------

async function timeAsync(label: string, iters: number, fn: () => Promise<unknown>) {
	// warm-up
	for (let i = 0; i < Math.min(20, iters); i++) await fn();
	const t0 = Bun.nanoseconds();
	for (let i = 0; i < iters; i++) await fn();
	const t1 = Bun.nanoseconds();
	const totalUs = (t1 - t0) / 1000;
	const perUs = totalUs / iters;
	return { label, iters, totalUs, perUs };
}

async function sanityCheck() {
	// Sanity: the handlers must produce non-empty payloads with the same shape
	// the tests expect. If they don't, abort the bench so a buggy "optimisation"
	// doesn't silently look fast.
	const fEnv = makeEnv(makeForumListDb());
	const fRes = await forumList(new Request("https://example.com/api/v1/forums"), fEnv, ctx);
	if (fRes.status !== 200) throw new Error(`forum list status ${fRes.status}`);
	// biome-ignore lint/suspicious/noExplicitAny: bench sanity check
	const fJson: any = await fRes.json();
	if (!Array.isArray(fJson.data) || fJson.data.length !== FORUM_COUNT) {
		throw new Error(`forum list shape: expected ${FORUM_COUNT} forums, got ${fJson.data?.length}`);
	}
	const f0 = fJson.data[0];
	for (const k of ["id", "name", "moderatorList", "lastPostAt", "todayThreads"]) {
		if (!(k in f0)) throw new Error(`forum list missing field: ${k}`);
	}

	const tEnv = makeEnv(makeThreadListDb(1));
	const tRes = await threadList(
		new Request("https://example.com/api/v1/threads?forumId=1&limit=100"),
		tEnv,
		ctx,
	);
	if (tRes.status !== 200) throw new Error(`thread list status ${tRes.status}`);
	// biome-ignore lint/suspicious/noExplicitAny: bench sanity check
	const tJson: any = await tRes.json();
	if (!Array.isArray(tJson.data) || tJson.data.length === 0) {
		throw new Error("thread list shape: empty data");
	}
	const t0 = tJson.data[0];
	for (const k of ["id", "forumId", "authorId", "subject", "lastPostAt"]) {
		if (!(k in t0)) throw new Error(`thread list missing field: ${k}`);
	}
}

async function main() {
	await sanityCheck();

	const ITERS = Number.parseInt(process.env.BENCH_ITERS ?? "5000", 10);

	const fEnv = makeEnv(makeForumListDb());
	const forumReq = new Request("https://example.com/api/v1/forums");
	const forum = await timeAsync("forum_list", ITERS, async () => {
		await forumList(forumReq, fEnv, ctx);
	});

	// rotate forum id so we exercise multiple thread datasets
	const tEnvs = new Map<number, ReturnType<typeof makeEnv>>();
	const threadReqs = new Map<number, Request>();
	for (let i = 1; i <= FORUM_COUNT; i++) {
		tEnvs.set(i, makeEnv(makeThreadListDb(i)));
		threadReqs.set(i, new Request(`https://example.com/api/v1/threads?forumId=${i}&limit=100`));
	}
	let idx = 0;
	const thread = await timeAsync("thread_list", ITERS, async () => {
		idx = (idx % FORUM_COUNT) + 1;
		// biome-ignore lint/style/noNonNullAssertion: map is pre-populated for all indices
		await threadList(threadReqs.get(idx)!, tEnvs.get(idx)!, ctx);
	});

	const totalUs = forum.totalUs + thread.totalUs;

	console.log(
		`forum_list  iters=${forum.iters}  total=${forum.totalUs.toFixed(0)}µs  per=${forum.perUs.toFixed(1)}µs`,
	);
	console.log(
		`thread_list iters=${thread.iters}  total=${thread.totalUs.toFixed(0)}µs  per=${thread.perUs.toFixed(1)}µs`,
	);
	console.log(`combined total=${totalUs.toFixed(0)}µs`);

	console.log(`METRIC total_µs=${totalUs.toFixed(0)}`);
	console.log(`METRIC forum_list_µs=${forum.perUs.toFixed(1)}`);
	console.log(`METRIC thread_list_µs=${thread.perUs.toFixed(1)}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
