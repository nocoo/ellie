// Regression test: FTS5 triggers on a regular (standalone) FTS5 table.
//
// The original 0023 migration used the "delete command" syntax intended for
// external-content FTS5 tables. On a regular FTS5 table this causes
// "SQL logic error: SQLITE_ERROR" on any DELETE FROM threads (including
// the nuke-user batch). This test verifies the corrected triggers work.
//
// Uses node:sqlite (Node.js 22+) to run real SQLite — not mocked.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/** Minimal schema mirroring production threads + threads_fts. */
function createSchema(db: DatabaseSync) {
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

/** Install the BROKEN triggers (content-table "delete command" style). */
function installBrokenTriggers(db: DatabaseSync) {
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

/** Install the FIXED triggers (standard DELETE for regular FTS5). */
function installFixedTriggers(db: DatabaseSync) {
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

function ftsMatch(db: DatabaseSync, query: string): string[] {
	const rows = db.prepare("SELECT subject FROM threads_fts WHERE threads_fts MATCH ?").all(query);
	return (rows as { subject: string }[]).map((r) => r.subject);
}

describe("threads_fts triggers — regular FTS5 table", () => {
	it("broken trigger: DELETE FROM threads throws SQL logic error", () => {
		const db = new DatabaseSync(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(() => {
			db.exec("DELETE FROM threads WHERE id = 1");
		}).toThrow(/SQL logic error/);
		db.close();
	});

	it("broken trigger: UPDATE subject throws SQL logic error", () => {
		const db = new DatabaseSync(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(() => {
			db.exec("UPDATE threads SET subject = 'goodbye world' WHERE id = 1");
		}).toThrow(/SQL logic error/);
		db.close();
	});

	it("fixed trigger: INSERT syncs to FTS", () => {
		const db = new DatabaseSync(":memory:");
		createSchema(db);
		installFixedTriggers(db);

		db.exec(
			"INSERT INTO threads (id, forum_id, author_id, subject) VALUES (1, 1, 1, 'hello world')",
		);
		expect(ftsMatch(db, "hello")).toEqual(["hello world"]);
		db.close();
	});

	it("fixed trigger: DELETE removes from FTS without error", () => {
		const db = new DatabaseSync(":memory:");
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
		const db = new DatabaseSync(":memory:");
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
		const db = new DatabaseSync(":memory:");
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
		const db = new DatabaseSync(":memory:");
		createSchema(db);
		installBrokenTriggers(db);

		// Apply the migration fix (same SQL as 0034)
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

		// Now insert, update, delete should all work
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
