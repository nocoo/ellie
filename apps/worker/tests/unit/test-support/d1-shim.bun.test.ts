import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { wrapAsD1 } from "../../../src/test-support/d1-shim";

function setupDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			age INTEGER
		);
		CREATE TABLE posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			body TEXT NOT NULL DEFAULT ''
		);
	`);
	return db;
}

describe("wrapAsD1 — single statement API", () => {
	test("prepare(SELECT).bind().all() returns rows", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name, age) VALUES (?, ?)", "alice", 30);
		sqlite.run("INSERT INTO users (name, age) VALUES (?, ?)", "bob", 40);
		const db = wrapAsD1(sqlite);

		const result = await db.prepare("SELECT name, age FROM users WHERE age >= ?").bind(30).all();
		expect(result.success).toBe(true);
		expect(result.results).toEqual([
			{ name: "alice", age: 30 },
			{ name: "bob", age: 40 },
		]);
	});

	test("prepare(SELECT).first() returns first row or null", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name) VALUES ('alice')");
		const db = wrapAsD1(sqlite);

		const row = await db.prepare("SELECT name FROM users WHERE name = ?").bind("alice").first();
		expect(row).toEqual({ name: "alice" });

		const missing = await db.prepare("SELECT name FROM users WHERE name = ?").bind("none").first();
		expect(missing).toBeNull();
	});

	test("prepare(SELECT).first('col') returns the column value", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name, age) VALUES ('alice', 30)");
		const db = wrapAsD1(sqlite);

		const age = await db.prepare("SELECT age FROM users WHERE name = ?").bind("alice").first("age");
		expect(age).toBe(30);
	});

	test("prepare(INSERT).run() returns meta with changes + last_row_id", async () => {
		const sqlite = setupDb();
		const db = wrapAsD1(sqlite);

		const r = await db.prepare("INSERT INTO users (name) VALUES (?)").bind("alice").run();
		expect(r.success).toBe(true);
		expect(r.meta.changes).toBe(1);
		expect(r.meta.last_row_id).toBe(1);
		expect(r.results).toEqual([]);
	});

	test("prepare(UPDATE).run() reports changes count", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name) VALUES ('a'), ('b'), ('c')");
		const db = wrapAsD1(sqlite);

		const r = await db.prepare("UPDATE users SET age = ? WHERE name IN ('a','b')").bind(99).run();
		expect(r.meta.changes).toBe(2);
	});

	test("prepare(SELECT).raw() returns array of arrays", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name, age) VALUES ('alice', 30)");
		const db = wrapAsD1(sqlite);

		const rows = await db.prepare("SELECT name, age FROM users").raw();
		expect(rows).toEqual([["alice", 30]]);
	});

	test("bind returns a new statement (chainable / reusable)", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name) VALUES ('alice'), ('bob')");
		const db = wrapAsD1(sqlite);

		const stmt = db.prepare("SELECT name FROM users WHERE name = ?");
		const aliceRow = await stmt.bind("alice").first();
		const bobRow = await stmt.bind("bob").first();
		expect(aliceRow).toEqual({ name: "alice" });
		expect(bobRow).toEqual({ name: "bob" });
	});
});

describe("wrapAsD1 — batch() dispatch", () => {
	test("batch with mixed SELECT + writes returns correct shapes per statement", async () => {
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name) VALUES ('a'), ('b'), ('c')");
		const db = wrapAsD1(sqlite);

		const [count, insert, postCount] = await db.batch([
			db.prepare("SELECT COUNT(*) AS cnt FROM users"),
			db.prepare("INSERT INTO posts (user_id, body) VALUES (?, ?)").bind(1, "hi"),
			db.prepare("SELECT COUNT(*) AS cnt FROM posts"),
		]);

		// SELECT 0 → results populated
		expect((count.results[0] as { cnt: number }).cnt).toBe(3);
		// INSERT 1 → results empty, meta.changes=1
		expect(insert.results).toEqual([]);
		expect(insert.meta.changes).toBe(1);
		// SELECT 2 → results populated
		expect((postCount.results[0] as { cnt: number }).cnt).toBe(1);
	});

	test("batch covering admin/stats.ts shape (parallel SELECT COUNT)", async () => {
		// Smoke test: exact shape used by handlers/admin/stats.ts:19
		// where results[i].results[0].cnt is read for each statement.
		const sqlite = setupDb();
		sqlite.run("INSERT INTO users (name) VALUES ('a'), ('b')");
		sqlite.run("INSERT INTO posts (user_id, body) VALUES (1, 'p1'), (2, 'p2')");
		const db = wrapAsD1(sqlite);

		const todayUtc = 1_700_000_000;
		const results = await db.batch([
			db.prepare("SELECT COUNT(*) AS cnt FROM users"),
			db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE id >= ?").bind(todayUtc),
			db.prepare("SELECT COUNT(*) AS cnt FROM posts"),
		]);
		const count = (i: number) => (results[i].results[0] as Record<string, number>).cnt;
		expect(count(0)).toBe(2);
		expect(count(1)).toBe(0);
		expect(count(2)).toBe(2);
	});

	test("batch INSERT-only returns meta per statement", async () => {
		const sqlite = setupDb();
		const db = wrapAsD1(sqlite);

		const results = await db.batch([
			db.prepare("INSERT INTO users (name) VALUES ('a')"),
			db.prepare("INSERT INTO users (name) VALUES ('b')"),
		]);
		expect(results[0].meta.changes).toBe(1);
		expect(results[0].meta.last_row_id).toBe(1);
		expect(results[1].meta.changes).toBe(1);
		expect(results[1].meta.last_row_id).toBe(2);
	});
});

describe("wrapAsD1 — db-level methods", () => {
	test("exec runs multi-statement SQL", async () => {
		const sqlite = setupDb();
		const db = wrapAsD1(sqlite);
		await db.exec(`
			INSERT INTO users (name) VALUES ('exec-a');
			INSERT INTO users (name) VALUES ('exec-b');
		`);
		const r = await db.prepare("SELECT COUNT(*) AS cnt FROM users").first<{ cnt: number }>();
		expect(r?.cnt).toBe(2);
	});

	test("dump throws an explicit unsupported error", async () => {
		const sqlite = setupDb();
		const db = wrapAsD1(sqlite);
		await expect(db.dump()).rejects.toThrow(/dump\(\) not supported/);
	});
});
