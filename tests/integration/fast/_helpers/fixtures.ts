/**
 * tests/integration/fast/_helpers/fixtures — seed helpers for L2-fast specs.
 *
 * Each helper writes minimal rows directly through the in-memory sqlite
 * handle exposed by createTestEnv. Use sparingly: L2-fast prefers
 * per-spec, explicit INSERTs so each test reads as self-contained.
 */

import type { TestEnv } from "./env";

export interface SeedUserOpts {
	id?: number;
	uid?: number;
	email: string;
	username?: string;
	status?: number;
	role?: number;
	emailVerifiedAt?: number;
	createdAt?: number;
}

/**
 * Insert an active user with the minimum columns required to satisfy the
 * worker's auth + read paths. Returns the row id (auto-increment if not
 * given). The schema is the one materialized from INIT_SQL — see
 * apps/worker/migrations/0000_init_schema.sql for the users table.
 */
export function seedUser(env: TestEnv, opts: SeedUserOpts): number {
	const now = opts.createdAt ?? Math.floor(Date.now() / 1000);
	const stmt = env._sqlite.prepare(
		`INSERT INTO users (
			id, uid, email, username, password_hash, status, role,
			email_verified_at, email_normalized, reg_date, last_login
		) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
	);
	const id = opts.id ?? null;
	const uid = opts.uid ?? id ?? 1;
	const username = opts.username ?? opts.email.split("@")[0];
	const status = opts.status ?? 0;
	const role = opts.role ?? 0;
	const verified = opts.emailVerifiedAt ?? now;
	const normalized = opts.email.trim().toLowerCase();
	const r = stmt.run(id, uid, opts.email, username, status, role, verified, normalized, now, now);
	return Number(r.lastInsertRowid);
}

export interface SeedForumOpts {
	id?: number;
	name: string;
	parentId?: number;
	status?: number;
	displayOrder?: number;
}

/** Insert a minimal forum row. Returns the assigned id. */
export function seedForum(env: TestEnv, opts: SeedForumOpts): number {
	const now = Math.floor(Date.now() / 1000);
	const r = env._sqlite
		.prepare(
			`INSERT INTO forums (id, parent_id, name, status, display_order, threads, posts, created_at)
			 VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
		)
		.run(
			opts.id ?? null,
			opts.parentId ?? 0,
			opts.name,
			opts.status ?? 0,
			opts.displayOrder ?? 0,
			now,
		);
	return Number(r.lastInsertRowid);
}
