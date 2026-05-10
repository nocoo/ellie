// Regression test: FTS5 triggers on a regular (standalone) FTS5 table.
//
// The original 0023 migration used the "delete command" syntax intended for
// external-content FTS5 tables. On a regular FTS5 table this causes
// "SQL logic error: SQLITE_ERROR" on any DELETE FROM threads (including
// the nuke-user batch). This test verifies the corrected triggers work.
//
// Uses bun:sqlite to run real SQLite — not mocked. Runs on the bun
// runner (see scripts/run-tests.sh) because vitest's Node 20 runner
// lacks node:sqlite.

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

function createSchema(db: Database) {
	db.exec(`
		CREATE TABLE forums (id INTEGER PRIMARY KEY);
		INSERT INTO forums (id) VALUES (1);

		CREATE TABLE users (id INTEGER PRIMARY KEY);
		INSERT INTO users (id) VALUES (1);

		CREATE TABLE threads (
			id          INTEGER PRIMARY KEY,
			forum_id    INTEGER NOT NULL REFERENCES forums(id),
			author_id   INTEGER NOT NULL REFERENCES users(id),
			subject     TEXT    NOT NULL,
			created_at  INTEGER NOT NULL DEFAULT 0
		);

		CREATE VIRTUAL TABLE threads_fts USING fts5(
			subject,
			tokenize='unicode61'
		);
	`);
}

function installBrokenTriggers(db: Database) {
	db.exec(`
		CREATE TRIGGER threads_fts_ai AFTER INSERT ON threads BEGIN
			INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
		END;

		CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
			INSERT INTO threads_fts(threads_fts, rowid, subject)
			VALUES ('delete', old.id, old.subject);
		END;

		CREATE TRIGGER threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
			INSERT INTO threads_fts(threads_fts, rowid, subject)
			VALUES ('delete', old.id, old.subject);
			INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
		END;
	`);
}

function installFixedTriggers(db: Database) {
	db.exec(`
		CREATE TRIGGER threads_fts_ai AFTER INSERT ON threads BEGIN
			INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
		END;

		CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
			DELETE FROM threads_fts WHERE rowid = old.id;
		END;

		CREATE TRIGGER threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
			DELETE FROM threads_fts WHERE rowid = old.id;
			INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
		END;
	`);
}

function ftsMatch(db: Database, query: string): string[] {
	const rows = db
		.prepare("SELECT subject FROM threads_fts WHERE threads_fts MATCH ?")
		.all(query) as { subject: string }[];
	return rows.map((r) => r.subject);
}

describe("threads_fts triggers — regular FTS5 table", () => {
	it("broken trigger: DELETE FROM threads throws SQL logic error", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(() => {
			db.exec("DELETE FROM threads WHERE id = 1");
		}).toThrow(/SQL logic error|SQLITE_ERROR/);
		db.close();
	});

	it("broken trigger: UPDATE subject throws SQL logic error", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(() => {
			db.exec("UPDATE threads SET subject = 'goodbye world' WHERE id = 1");
		}).toThrow(/SQL logic error|SQLITE_ERROR/);
		db.close();
	});

	it("fixed trigger: INSERT syncs to FTS", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installFixedTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(ftsMatch(db, "hello")).toEqual(["hello world"]);
		db.close();
	});

	it("fixed trigger: DELETE removes from FTS without error", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installFixedTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (2, 1, 1, 'goodbye world')",
		);

		expect(ftsMatch(db, "hello")).toEqual(["hello world"]);
		db.exec("DELETE FROM threads WHERE id = 1");
		expect(ftsMatch(db, "hello")).toEqual([]);
		expect(ftsMatch(db, "goodbye")).toEqual(["goodbye world"]);
		db.close();
	});

	it("fixed trigger: bulk DELETE (author_id) removes all from FTS", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installFixedTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'first thread')",
		);
		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (2, 1, 1, 'second thread')",
		);
		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (3, 1, 1, 'third thread')",
		);

		expect(ftsMatch(db, "thread")).toHaveLength(3);
		db.exec("DELETE FROM threads WHERE author_id = 1");
		expect(ftsMatch(db, "thread")).toEqual([]);
		db.close();
	});

	it("fixed trigger: UPDATE subject syncs FTS", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installFixedTriggers(db);

		db.exec("INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'old title')");
		expect(ftsMatch(db, "old")).toEqual(["old title"]);

		db.exec("UPDATE threads SET subject = 'new title' WHERE id = 1");
		expect(ftsMatch(db, "old")).toEqual([]);
		expect(ftsMatch(db, "new")).toEqual(["new title"]);
		db.close();
	});

	it("migration 0034 correctly replaces broken triggers", () => {
		const db = new Database(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		db.exec("DROP TRIGGER IF EXISTS threads_fts_ad");
		db.exec("DROP TRIGGER IF EXISTS threads_fts_au");
		db.exec(`
			CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
				DELETE FROM threads_fts WHERE rowid = old.id;
			END;
		`);
		db.exec(`
			CREATE TRIGGER threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
				DELETE FROM threads_fts WHERE rowid = old.id;
				INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
			END;
		`);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'test thread')",
		);
		expect(ftsMatch(db, "test")).toEqual(["test thread"]);

		db.exec("UPDATE threads SET subject = 'updated thread' WHERE id = 1");
		expect(ftsMatch(db, "test")).toEqual([]);
		expect(ftsMatch(db, "updated")).toEqual(["updated thread"]);

		db.exec("DELETE FROM threads WHERE id = 1");
		expect(ftsMatch(db, "updated")).toEqual([]);
		db.close();
	});
});
