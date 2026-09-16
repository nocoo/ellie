import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

describe("L2-fast: user purge with large content sets", () => {
	test.each([
		{ threads: 50, replies: 0, collateral: 0 },
		{ threads: 151, replies: 120, collateral: 1 },
	])("purges $threads threads under D1's parameter limit", async (counts) => {
		const env = createTestEnv();
		const db = env._sqlite;
		// bun:sqlite permits more bindings than D1. Enforce the documented
		// production limit while executing the real SQL against our schema.
		const prepare = env.DB.prepare.bind(env.DB);
		env.DB.prepare = (sql) => {
			const statement = prepare(sql);
			const bind = statement.bind.bind(statement);
			statement.bind = (...values: unknown[]) => {
				if (values.length > 100) throw new Error("D1_ERROR: too many SQL variables");
				return bind(...values);
			};
			return statement;
		};

		try {
			db.exec("PRAGMA foreign_keys = ON");
			db.query("INSERT INTO users (id, username, threads, posts) VALUES (?, ?, ?, ?)").run(
				42,
				"purge-target",
				counts.threads,
				counts.threads + counts.replies,
			);
			db.query("INSERT INTO users (id, username, threads, posts) VALUES (99, ?, 1, ?)").run(
				"survivor",
				1 + counts.collateral,
			);
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
