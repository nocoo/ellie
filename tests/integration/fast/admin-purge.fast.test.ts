import "./_helpers/setup";

import { describe, expect, spyOn, test } from "bun:test";
import { createJwt } from "../../../apps/worker/src/lib/jwt";
import { createTestEnv, workerFetch } from "./_helpers/env";

function seedContent(counts = { threads: 151, replies: 120, collateral: 1 }) {
	const env = createTestEnv();
	const db = env._sqlite;

	db.exec("PRAGMA foreign_keys = ON");
	db.query("INSERT INTO users (id, username, threads, posts) VALUES (?, ?, ?, ?)").run(
		42,
		"purge-target",
		counts.threads,
		counts.threads + counts.replies,
	);
	db.query(
		"INSERT INTO users (id, username, threads, posts, role, email_verified_at) VALUES (99, ?, 1, ?, 1, 1)",
	).run("survivor", 1 + counts.collateral);
	db.query("INSERT INTO forums (id, name, threads, posts) VALUES (7, ?, ?, ?)").run(
		"Test forum",
		counts.threads + 1,
		counts.threads + counts.replies + counts.collateral + 1,
	);
	const thread = db.query(
		"INSERT INTO threads (id, forum_id, author_id, subject, replies) VALUES (?, 7, ?, ?, ?)",
	);
	const post = db.query(
		"INSERT INTO posts (id, thread_id, forum_id, author_id, is_first) VALUES (?, ?, 7, ?, ?)",
	);
	for (let i = 1; i <= counts.threads; i++) {
		thread.run(i, 42, `Owned thread ${i}`, i === 1 ? counts.collateral : 0);
		post.run(i, i, 42, 1);
	}
	thread.run(900, 99, "Preserved thread", counts.replies);
	post.run(900, 900, 99, 1);
	if (counts.collateral) post.run(800, 1, 99, 0);
	for (let i = 0; i < counts.replies; i++) post.run(1000 + i, 900, 42, 0);

	// Child rows cover both collateral content and the target's own
	// contributions attached to a surviving author's post.
	for (const [id, tid, pid, author] of [
		[1, 1, 1, 99],
		[2, 900, 900, 42],
		[3, 900, 900, 99],
	]) {
		db.query(
			"INSERT INTO attachments (id, thread_id, post_id, author_id, filename, file_path) VALUES (?, ?, ?, ?, ?, ?)",
		).run(id, tid, pid, author, `${id}.png`, `attachments/${id}.png`);
		db.query(
			"INSERT INTO post_comments (id, thread_id, post_id, author_id) VALUES (?, ?, ?, ?)",
		).run(id, tid, pid, author);
	}
	db.query("INSERT INTO forum_recommended_threads VALUES (7, 1, 1, 99), (7, 900, 1, 99)").run();
	db.query(`
		INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name, content, created_at)
		VALUES (1, 42, 'target', 99, 'survivor', 'outgoing', 1),
		       (2, 99, 'survivor', 42, 'target', 'incoming', 1),
		       (3, 99, 'survivor', 99, 'survivor', 'preserved', 1)
	`).run();
	db.query(
		"INSERT INTO reports (type, target_id, reporter_id, created_at) VALUES ('user', 42, 99, 1)",
	).run();
	return env;
}

describe("L2-fast: user purge with large content sets", () => {
	test.each([
		{ threads: 50, replies: 0, collateral: 0 },
		{ threads: 151, replies: 120, collateral: 1 },
	])("purges $threads threads under D1's parameter limit", async (counts) => {
		const env = seedContent(counts);
		const db = env._sqlite;
		try {
			const res = await workerFetch(env, "/api/admin/users/42/purge", {
				method: "POST",
				headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ confirm: "ok" }),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.deleted).toEqual({
				threads: counts.threads,
				posts: counts.threads + counts.replies + counts.collateral,
				comments: 2,
				attachments: 2,
				messages: 2,
			});
			expect(body.data.r2).toEqual({ deletedCount: 2, failed: [] });
			expect(db.query("SELECT status, threads, posts FROM users WHERE id = 42").get()).toEqual({
				status: -99,
				threads: 0,
				posts: 0,
			});
			expect(db.query("SELECT posts FROM users WHERE id = 99").get()).toEqual({ posts: 1 });
			expect(db.query("SELECT threads, posts FROM forums WHERE id = 7").get()).toEqual({
				threads: 1,
				posts: 1,
			});
			expect(db.query("SELECT id, replies FROM threads").all()).toEqual([{ id: 900, replies: 0 }]);
			expect(db.query("SELECT id FROM posts").all()).toEqual([{ id: 900 }]);
			for (const table of ["attachments", "post_comments", "messages"]) {
				expect(db.query(`SELECT id FROM ${table}`).all()).toEqual([{ id: 3 }]);
			}
			expect(db.query("SELECT thread_id FROM forum_recommended_threads").all()).toEqual([
				{ thread_id: 900 },
			]);
			expect(db.query("SELECT target_id FROM reports").all()).toEqual([{ target_id: 42 }]);
			expect(db.query("SELECT action FROM admin_logs").all()).toEqual([{ action: "user.purge" }]);
			expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
		} finally {
			db.close();
		}
	});
});

// Real SQLite constraints and triggers exercise the same batch SQL as the
// deployed Worker. Nothing in this suite can reach production bindings.
const destructiveActions = ["purge", "ban", "nuke", "moderation"] as const;

async function requestAction(env: ReturnType<typeof createTestEnv>, action: string) {
	if (action === "moderation") {
		const token = await createJwt(
			{ userId: 99, role: 1, exp: Math.floor(Date.now() / 1000) + 60 },
			env.JWT_SECRET,
		);
		return workerFetch(env, "/api/v1/moderation/users/42/nuke", {
			method: "POST",
			headers: { "X-API-Key": env.API_KEY, Authorization: `Bearer ${token}` },
		});
	}
	return workerFetch(env, `/api/admin/users/42/${action}`, {
		method: "POST",
		headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
		body: JSON.stringify({ confirm: "ok", deleteContent: true }),
	});
}

describe("L2-fast: safe administrative batches", () => {
	test.each(destructiveActions)(
		"%s keeps concurrent themes and first posts together",
		async (action) => {
			const env = seedContent({ threads: 1, replies: 0, collateral: 0 });
			const db = env._sqlite;
			const prepare = env.DB.prepare.bind(env.DB);
			let inserted = false;
			try {
				// Commit a new topic while the ownership queries are being prepared.
				// Independent SELECTs split this topic from its first post; a read
				// batch sees both in the same snapshot and removes them together.
				env.DB.prepare = (sql) => {
					if (
						!inserted &&
						sql.startsWith("SELECT id, thread_id, forum_id, author_id FROM posts WHERE author_id")
					) {
						inserted = true;
						db.transaction(() => {
							db.exec(
								"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (200, 7, 42, 'Concurrent topic'); INSERT INTO posts (id, thread_id, forum_id, author_id, is_first) VALUES (200, 200, 7, 42, 1); UPDATE users SET threads = threads + 1, posts = posts + 1 WHERE id = 42",
							);
						})();
					}
					return prepare(sql);
				};
				expect((await requestAction(env, action)).status).toBe(200);
				expect(inserted).toBe(true);
				expect(db.query("SELECT id FROM threads WHERE author_id = 42").all()).toEqual([]);
				expect(db.query("SELECT id FROM posts WHERE author_id = 42").all()).toEqual([]);
				expect(db.query("SELECT id FROM threads").all()).toEqual([{ id: 900 }]);
				expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
			} finally {
				db.close();
			}
		},
	);

	test("explicit cache deletion fails without claiming success or writing a success audit", async () => {
		const env = createTestEnv();
		await env.KV.put("user:mini:42", "retained");
		const deletion = spyOn(env.KV, "delete").mockRejectedValue(new Error("local KV failure"));
		try {
			const response = await workerFetch(env, "/api/admin/kv/refresh", {
				method: "POST",
				headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({
					family: "user:mini:v1",
					action: { kind: "delete-user-mini", userId: 42 },
				}),
			});
			expect(response.status).toBe(500);
			expect(await env.KV.get("user:mini:42")).toBe("retained");
			expect(env._sqlite.query("SELECT * FROM admin_logs").all()).toEqual([]);
		} finally {
			deletion.mockRestore();
			env._sqlite.close();
		}
	});

	test.each(["ban", "nuke", "moderation"])(
		"%s deletes large content sets and repairs metadata atomically",
		async (action) => {
			const env = seedContent();
			const db = env._sqlite;
			try {
				// Drifted counters and hidden content must not distort deletion totals.
				db.exec(
					"UPDATE threads SET replies = 999; UPDATE users SET credits = 20, coins = 30, digest_posts = 5 WHERE id = 42",
				);
				db.exec("UPDATE posts SET invisible = 1 WHERE id = 1");
				const response = await requestAction(env, action);
				expect(response.status).toBe(200);
				const data = (await response.json()).data;
				expect(data.threadsDeleted).toBe(151);
				expect(data.postsDeleted).toBe(272);
				expect(
					db
						.query(
							"SELECT status, threads, posts, digest_posts, credits, coins FROM users WHERE id = 42",
						)
						.get(),
				).toEqual({
					status: -1,
					threads: 0,
					posts: 0,
					digest_posts: 0,
					credits: action === "ban" ? 20 : 0,
					coins: action === "ban" ? 30 : 0,
				});
				expect(db.query("SELECT posts FROM users WHERE id = 99").get()).toEqual({ posts: 1 });
				expect(db.query("SELECT id, replies FROM threads").all()).toEqual([
					{ id: 900, replies: 0 },
				]);
				expect(
					db.query("SELECT threads, posts, last_thread_id FROM forums WHERE id = 7").get(),
				).toEqual({ threads: 1, posts: 1, last_thread_id: 900 });
				expect(db.query("SELECT thread_id FROM forum_recommended_threads").all()).toEqual([
					{ thread_id: 900 },
				]);
				expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
			} finally {
				db.close();
			}
		},
	);

	for (const action of destructiveActions) {
		test.each(["forums", "users"])(
			`${action} rolls back all content when %s repair fails, and can be retried`,
			async (failTable) => {
				const env = seedContent({ threads: 50, replies: 2, collateral: 1 });
				const db = env._sqlite;
				const r2Delete = spyOn(env.R2, "delete");
				const tables = [
					"users",
					"threads",
					"posts",
					"forums",
					"attachments",
					"post_comments",
					"messages",
					"reports",
					"forum_recommended_threads",
					"admin_logs",
				];
				const snapshot = () =>
					tables.map((table) =>
						db
							.query(`SELECT * FROM ${table} ORDER BY rowid`)
							.all()
							.map((row) => {
								// The moderator's independent heartbeat is not a content mutation.
								const value = row as Record<string, unknown>;
								return table === "users" && value.id === 99
									? { ...value, last_activity: 0 }
									: value;
							}),
					);
				try {
					const before = snapshot();
					db.exec(
						`CREATE TRIGGER fail_repair BEFORE UPDATE ${failTable === "users" ? "OF posts" : ""} ON ${failTable} BEGIN SELECT RAISE(ABORT, 'injected local failure'); END`,
					);
					const response = await requestAction(env, action);
					expect(response.status).toBe(500);
					if (action === "purge")
						expect((await response.json()).error.code).toBe("PURGE_DB_FAILED");
					expect(snapshot()).toEqual(before);
					expect(r2Delete).not.toHaveBeenCalled();
					expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
					db.exec("DROP TRIGGER fail_repair");
					expect((await requestAction(env, action)).status).toBe(200);
				} finally {
					r2Delete.mockRestore();
					db.close();
				}
			},
		);
	}

	test("repairs latest visible metadata before recalculating forum summaries", async () => {
		const env = seedContent({ threads: 50, replies: 2, collateral: 1 });
		const db = env._sqlite;
		try {
			db.exec("UPDATE posts SET position = 1, created_at = 100 WHERE id = 900");
			db.exec("UPDATE posts SET position = 5, created_at = 500 WHERE author_id = 42");
			db.exec(
				"INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, position, created_at, invisible, anonymous) VALUES (901, 900, 7, 99, 'survivor', 2, 200, 0, 1), (902, 900, 7, 99, 'hidden', 3, 300, 1, 0)",
			);
			db.exec("UPDATE users SET posts = 4 WHERE id = 99");
			expect((await requestAction(env, "purge")).status).toBe(200);
			expect(
				db
					.query(
						"SELECT replies, last_post_at, last_poster, anonymous_last_poster FROM threads WHERE id = 900",
					)
					.get(),
			).toEqual({
				replies: 1,
				last_post_at: 200,
				last_poster: "survivor",
				anonymous_last_poster: 1,
			});
			expect(
				db
					.query(
						"SELECT threads, posts, last_thread_id, last_post_at, last_poster FROM forums WHERE id = 7",
					)
					.get(),
			).toEqual({
				threads: 1,
				posts: 2,
				last_thread_id: 900,
				last_post_at: 200,
				last_poster: "survivor",
			});
			expect(db.query("SELECT posts FROM users WHERE id = 99").get()).toEqual({ posts: 3 });
		} finally {
			db.close();
		}
	});

	test("a cache outage cannot turn a committed purge into a 500 or skip storage cleanup", async () => {
		const env = seedContent({ threads: 50, replies: 0, collateral: 0 });
		const deletion = spyOn(env.KV, "delete").mockRejectedValue(new Error("local KV failure"));
		try {
			const response = await requestAction(env, "purge");
			expect(response.status).toBe(200);
			expect((await response.json()).data.r2).toEqual({ deletedCount: 2, failed: [] });
			expect(env._sqlite.query("SELECT action FROM admin_logs").all()).toEqual([
				{ action: "user.purge" },
			]);
		} finally {
			deletion.mockRestore();
			env._sqlite.close();
		}
	});

	test.each(["status", "role"])(
		"updates 100 user %s values without exceeding 100 bindings",
		async (field) => {
			const env = createTestEnv();
			const db = env._sqlite;
			try {
				const ids = Array.from({ length: 100 }, (_, i) => i + 1);
				for (const id of [...ids, 101])
					db.query("INSERT INTO users (id, username) VALUES (?, ?)").run(id, `batch-${id}`);
				const value = field === "status" ? -1 : 3;
				const response = await workerFetch(env, `/api/admin/users/batch-${field}`, {
					method: "POST",
					headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
					body: JSON.stringify({ ids, [field]: value }),
				});
				expect(response.status).toBe(200);
				expect(
					db.query(`SELECT COUNT(*) AS count FROM users WHERE ${field} = ?`).get(value),
				).toEqual({ count: 100 });
				expect(db.query(`SELECT ${field} FROM users WHERE id = 101`).get()).toEqual({ [field]: 0 });
			} finally {
				db.close();
			}
		},
	);

	test("recalculates 1000 users in one batch and preserves other users", async () => {
		const env = createTestEnv();
		const db = env._sqlite;
		try {
			const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
			for (const id of [...ids, 1001])
				db.query(
					"INSERT INTO users (id, username, posts, threads, digest_posts) VALUES (?, ?, 999, 999, 999)",
				).run(id, `recalc-${id}`);
			db.exec(
				"INSERT INTO forums (id, name) VALUES (7, 'Recalc'); INSERT INTO threads (id, forum_id, author_id, digest, subject) VALUES (1, 7, 1, 1, 'Digest thread'); INSERT INTO posts (id, thread_id, forum_id, author_id, is_first) VALUES (1, 1, 7, 1, 1), (2, 1, 7, 2, 0)",
			);
			const response = await workerFetch(env, "/api/admin/users/batch-recalc-counters", {
				method: "POST",
				headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ ids }),
			});
			expect(response.status).toBe(200);
			expect((await response.json()).data.updated).toBe(1000);
			expect(
				db
					.query(
						"SELECT id, threads, posts, digest_posts FROM users WHERE id IN (1, 2, 1000, 1001) ORDER BY id",
					)
					.all(),
			).toEqual([
				{ id: 1, threads: 1, posts: 1, digest_posts: 1 },
				{ id: 2, threads: 0, posts: 1, digest_posts: 0 },
				{ id: 1000, threads: 0, posts: 0, digest_posts: 0 },
				{ id: 1001, threads: 999, posts: 999, digest_posts: 999 },
			]);
		} finally {
			db.close();
		}
	});
});

function contentAction(env: ReturnType<typeof createTestEnv>, action: string) {
	const paths: Record<string, string> = {
		post: "/api/admin/posts/1000",
		thread: "/api/admin/threads/1",
		posts: "/api/admin/posts/batch-delete",
		threads: "/api/admin/threads/batch-delete",
		move: "/api/admin/threads/batch-move",
	};
	const isSingle = action === "post" || action === "thread";
	const ids =
		action === "posts"
			? [...Array.from({ length: 99 }, (_, i) => 1000 + i), 900]
			: Array.from({ length: 100 }, (_, i) => i + 1);
	return workerFetch(env, paths[action], {
		method: isSingle ? "DELETE" : "POST",
		headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
		...(isSingle ? {} : { body: JSON.stringify({ ids, forumId: 8 }) }),
	});
}

describe("L2-fast: atomic post and thread operations", () => {
	test("batch post deletion skips first posts and keeps user/thread/forum counts consistent", async () => {
		const env = seedContent({ threads: 2, replies: 100, collateral: 1 });
		const db = env._sqlite;
		try {
			const response = await contentAction(env, "posts");
			expect(response.status).toBe(200);
			expect((await response.json()).data).toEqual({ deleted: true, count: 99, skipped: [900] });
			expect(db.query("SELECT id FROM posts WHERE thread_id = 900 ORDER BY id").all()).toEqual([
				{ id: 900 },
				{ id: 1099 },
			]);
			expect(db.query("SELECT posts FROM users WHERE id = 42").get()).toEqual({ posts: 3 });
			expect(db.query("SELECT replies FROM threads WHERE id = 900").get()).toEqual({ replies: 1 });
			expect(db.query("SELECT posts, threads FROM forums WHERE id = 7").get()).toEqual({
				posts: 5,
				threads: 3,
			});
		} finally {
			db.close();
		}
	});

	test("batch thread deletion also cleans post-linked children whose thread reference differs", async () => {
		const env = seedContent({ threads: 100, replies: 120, collateral: 1 });
		const db = env._sqlite;
		try {
			db.exec(
				"UPDATE attachments SET thread_id = 900 WHERE id = 1; UPDATE post_comments SET thread_id = 900 WHERE id = 1; UPDATE threads SET digest = 1 WHERE id = 1; UPDATE users SET digest_posts = 1 WHERE id = 42",
			);
			const response = await contentAction(env, "threads");
			expect(response.status).toBe(200);
			expect((await response.json()).data.count).toBe(100);
			expect(
				db.query("SELECT posts, threads, digest_posts FROM users WHERE id = 42").get(),
			).toEqual({ posts: 120, threads: 0, digest_posts: 0 });
			expect(db.query("SELECT posts FROM users WHERE id = 99").get()).toEqual({ posts: 1 });
			expect(db.query("SELECT posts, threads FROM forums WHERE id = 7").get()).toEqual({
				posts: 121,
				threads: 1,
			});
			for (const table of ["attachments", "post_comments"])
				expect(db.query(`SELECT id FROM ${table} ORDER BY id`).all()).toEqual([
					{ id: 2 },
					{ id: 3 },
				]);
			expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	test("single thread deletion repairs more than 100 collateral authors in the same batch", async () => {
		const env = seedContent({ threads: 1, replies: 0, collateral: 0 });
		const db = env._sqlite;
		try {
			for (let id = 2000; id < 2151; id++) {
				db.query("INSERT INTO users (id, username, posts) VALUES (?, ?, 1)").run(id, `reply-${id}`);
				db.query("INSERT INTO posts (id, thread_id, forum_id, author_id) VALUES (?, 1, 7, ?)").run(
					id,
					id,
				);
			}
			const response = await contentAction(env, "thread");
			expect(response.status).toBe(200);
			expect((await response.json()).data.postsDeleted).toBe(152);
			expect(
				db.query("SELECT COUNT(*) AS count FROM users WHERE id >= 2000 AND posts = 0").get(),
			).toEqual({ count: 151 });
			expect(db.query("SELECT posts, threads FROM forums WHERE id = 7").get()).toEqual({
				posts: 1,
				threads: 1,
			});
		} finally {
			db.close();
		}
	});

	test("moves 100 threads with actual post counts and clears their old recommendations", async () => {
		const env = seedContent({ threads: 100, replies: 120, collateral: 1 });
		const db = env._sqlite;
		try {
			db.exec(
				"INSERT INTO forums (id, name) VALUES (8, 'Destination'); UPDATE threads SET replies = 999",
			);
			const response = await contentAction(env, "move");
			expect(response.status).toBe(200);
			expect(db.query("SELECT id, posts, threads FROM forums ORDER BY id").all()).toEqual([
				{ id: 7, posts: 121, threads: 1 },
				{ id: 8, posts: 101, threads: 100 },
			]);
			expect(
				db
					.query(
						"SELECT COUNT(*) AS count FROM posts WHERE forum_id != (SELECT forum_id FROM threads WHERE id = posts.thread_id)",
					)
					.get(),
			).toEqual({ count: 0 });
			expect(db.query("SELECT thread_id FROM forum_recommended_threads").all()).toEqual([
				{ thread_id: 900 },
			]);
		} finally {
			db.close();
		}
	});

	test.each(["post", "thread", "posts", "threads", "move"])(
		"%s rolls back children, content, counters and recommendations when metadata repair fails",
		async (action) => {
			const env = seedContent({ threads: 100, replies: 100, collateral: 1 });
			const db = env._sqlite;
			try {
				db.exec(
					"INSERT INTO forums (id, name) VALUES (8, 'Destination'); INSERT INTO attachments (id, filename, file_path, post_id, thread_id, author_id) VALUES (4, 'reply.png', 'attachments/reply.png', 1000, 900, 99)",
				);
				const tables = [
					"users",
					"threads",
					"posts",
					"forums",
					"attachments",
					"post_comments",
					"forum_recommended_threads",
					"admin_logs",
				];
				const snapshot = () =>
					tables.map((table) => db.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
				const before = snapshot();
				db.exec(
					"CREATE TRIGGER fail_forum BEFORE UPDATE ON forums BEGIN SELECT RAISE(ABORT, 'local metadata failure'); END",
				);
				expect((await contentAction(env, action)).status).toBe(500);
				expect(snapshot()).toEqual(before);
				db.exec("DROP TRIGGER fail_forum");
				expect((await contentAction(env, action)).status).toBe(200);
				expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
			} finally {
				db.close();
			}
		},
	);
});
