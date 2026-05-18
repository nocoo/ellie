// Migration 0040 — post_ratings schema test.
//
// Validates that the migration file in apps/worker/migrations/0040_create_post_ratings.sql
// produces the expected table + index shape, AND that the partial unique
// index on (rater_id, post_id, dimension) WHERE revoked_at=0 enforces
// the "one active rating per dimension" rule while still allowing a
// revoked row to be replaced by a fresh active row.
//
// Uses node:sqlite (Node.js 22+) to run real SQLite — not mocked.
// Mirrors the runtime feature-detect pattern from threads-fts-triggers.test.ts
// so CI environments without node:sqlite skip the suite cleanly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type DatabaseSyncCtor = new (
	path: string,
) => {
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): { changes: number; lastInsertRowid: number };
	};
	close(): void;
};

let DatabaseSync: DatabaseSyncCtor | null = null;
try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { createRequire } = require("node:module") as typeof import("node:module");
	const req = createRequire(import.meta.url);
	DatabaseSync = (req("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
} catch {
	DatabaseSync = null;
}
const hasNodeSqlite = DatabaseSync !== null;

type Db = InstanceType<DatabaseSyncCtor>;

const MIGRATION_PATH = join(__dirname, "../../../migrations/0040_create_post_ratings.sql");

function applyMigration(db: Db) {
	const sql = readFileSync(MIGRATION_PATH, "utf8");
	db.exec(sql);
}

function tableExists(db: Db, name: string): boolean {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(name) as { name?: string } | undefined;
	return Boolean(row?.name);
}

function indexSql(db: Db, name: string): string | null {
	const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as
		| { sql?: string }
		| undefined;
	return row?.sql ?? null;
}

function insertRating(
	db: Db,
	opts: {
		postId?: number;
		threadId?: number;
		raterId?: number;
		raterName?: string;
		dimension?: number;
		score?: number;
		reason?: string;
		createdAt?: number;
		revokedAt?: number;
		revokedBy?: number;
	} = {},
): { changes: number; lastInsertRowid: number } {
	return db
		.prepare(
			`INSERT INTO post_ratings
				(post_id, thread_id, rater_id, rater_name, dimension, score, reason,
				 created_at, revoked_at, revoked_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			opts.postId ?? 100,
			opts.threadId ?? 10,
			opts.raterId ?? 1,
			opts.raterName ?? "alice",
			opts.dimension ?? 2,
			opts.score ?? 5,
			opts.reason ?? "",
			opts.createdAt ?? 1_700_000_000,
			opts.revokedAt ?? 0,
			opts.revokedBy ?? 0,
		);
}

describe.skipIf(!hasNodeSqlite)("migration 0040 — post_ratings schema", () => {
	const SQLite = DatabaseSync as DatabaseSyncCtor;

	it("creates post_ratings table with expected columns", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);

		expect(tableExists(db, "post_ratings")).toBe(true);

		const cols = db.prepare("PRAGMA table_info(post_ratings)").all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
			pk: number;
		}>;
		const byName = new Map(cols.map((c) => [c.name, c]));

		// Required columns + types
		expect(byName.get("id")?.pk).toBe(1);
		expect(byName.get("post_id")?.notnull).toBe(1);
		expect(byName.get("thread_id")?.notnull).toBe(1);
		expect(byName.get("rater_id")?.notnull).toBe(1);
		expect(byName.get("rater_name")?.type).toBe("TEXT");
		expect(byName.get("dimension")?.notnull).toBe(1);
		expect(byName.get("score")?.notnull).toBe(1);
		expect(byName.get("reason")?.dflt_value).toBe("''");
		expect(byName.get("created_at")?.notnull).toBe(1);
		// revoked_* default to 0 (soft-revoke sentinels)
		expect(byName.get("revoked_at")?.dflt_value).toBe("0");
		expect(byName.get("revoked_by")?.dflt_value).toBe("0");

		db.close();
	});

	it("creates the four expected indexes", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);

		expect(indexSql(db, "idx_post_ratings_post")).toContain("post_id");
		expect(indexSql(db, "idx_post_ratings_thread")).toContain("thread_id");

		const raterDimTime = indexSql(db, "idx_post_ratings_rater_dim_time");
		expect(raterDimTime).toContain("rater_id");
		expect(raterDimTime).toContain("dimension");
		expect(raterDimTime).toContain("revoked_at = 0");

		const uq = indexSql(db, "uq_post_ratings_active");
		expect(uq).toContain("UNIQUE");
		expect(uq).toContain("rater_id");
		expect(uq).toContain("post_id");
		expect(uq).toContain("dimension");
		expect(uq).toContain("revoked_at = 0");

		db.close();
	});

	it("partial unique index rejects a second ACTIVE rating with same (rater, post, dim)", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);

		insertRating(db, { raterId: 1, postId: 100, dimension: 2, score: 5 });
		expect(() => insertRating(db, { raterId: 1, postId: 100, dimension: 2, score: 3 })).toThrow(
			/UNIQUE|constraint/i,
		);

		db.close();
	});

	it("partial unique index ALLOWS different dimension for same (rater, post)", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);

		insertRating(db, { raterId: 1, postId: 100, dimension: 1, score: 10 });
		expect(() =>
			insertRating(db, { raterId: 1, postId: 100, dimension: 2, score: 5 }),
		).not.toThrow();

		db.close();
	});

	it("partial unique index ALLOWS re-rating after the previous row is revoked", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);

		// First active rating.
		const first = insertRating(db, { raterId: 1, postId: 100, dimension: 2, score: 5 });
		// Revoke it.
		db.prepare("UPDATE post_ratings SET revoked_at = ?, revoked_by = ? WHERE id = ?").run(
			1_700_000_100,
			999,
			first.lastInsertRowid,
		);
		// Same (rater, post, dim) now permitted because the previous row is no longer active.
		expect(() =>
			insertRating(db, {
				raterId: 1,
				postId: 100,
				dimension: 2,
				score: 4,
				createdAt: 1_700_000_200,
			}),
		).not.toThrow();

		// Two rows total: one revoked, one active.
		const rows = db
			.prepare(
				"SELECT revoked_at FROM post_ratings WHERE rater_id=1 AND post_id=100 AND dimension=2 ORDER BY id",
			)
			.all() as Array<{ revoked_at: number }>;
		expect(rows).toHaveLength(2);
		expect(rows[0].revoked_at).toBeGreaterThan(0);
		expect(rows[1].revoked_at).toBe(0);

		db.close();
	});

	it("rolling-24h quota query: SUM(ABS(score)) sees active rows only", () => {
		const db = new SQLite(":memory:");
		applyMigration(db);
		const now = 1_700_000_000;

		insertRating(db, { raterId: 1, postId: 100, dimension: 2, score: 5, createdAt: now });
		insertRating(db, { raterId: 1, postId: 101, dimension: 2, score: -3, createdAt: now + 1 });
		// Outside the 24h window — should be excluded.
		insertRating(db, {
			raterId: 1,
			postId: 102,
			dimension: 2,
			score: 50,
			createdAt: now - 86400 - 10,
		});
		// Revoked — should be excluded.
		insertRating(db, {
			raterId: 1,
			postId: 103,
			dimension: 2,
			score: 8,
			createdAt: now + 2,
			revokedAt: now + 50,
			revokedBy: 9,
		});

		const row = db
			.prepare(
				`SELECT COALESCE(SUM(ABS(score)), 0) AS used
				 FROM post_ratings
				 WHERE rater_id = ? AND dimension = ? AND revoked_at = 0 AND created_at >= ?`,
			)
			.get(1, 2, now - 86400) as { used: number };
		expect(row.used).toBe(8); // 5 + 3, the revoked 8 and out-of-window 50 are excluded.

		db.close();
	});
});
