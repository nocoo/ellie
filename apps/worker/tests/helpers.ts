// Shared test utilities for Cloudflare Worker tests

import { mock } from "bun:test";
import type { Env } from "../src/lib/env";
import { createJwt } from "../src/lib/jwt";

// ─── Constants ─────────────────────────────────────────────
export const TEST_API_KEY = "test-api-key";
export const TEST_JWT_SECRET = "test-secret-key-for-jwt-hs256";

// ─── Env Factory ───────────────────────────────────────────

export function makeEnv(overrides?: Partial<Env>): Env {
	return {
		API_KEY: TEST_API_KEY,
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: {} as KVNamespace,
		...overrides,
	};
}

// ─── D1 Row Factories ──────────────────────────────────────

export function makeD1ForumRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		parent_id: 0,
		name: "Test Forum",
		description: "A test forum",
		icon: "icon.png",
		display_order: 1,
		threads: 10,
		posts: 100,
		type: "forum",
		status: 1,
		last_thread_id: 42,
		last_post_at: 1711540800,
		last_poster: "alice",
		...overrides,
	};
}

export function makeD1ThreadRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		forum_id: 1,
		author_id: 10,
		author_name: "alice",
		subject: "Test Thread",
		created_at: 1711540800,
		last_post_at: 1711544400,
		last_poster: "bob",
		replies: 5,
		views: 100,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		...overrides,
	};
}

export function makeD1PostRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		thread_id: 1,
		forum_id: 1,
		author_id: 10,
		author_name: "alice",
		content: "<p>Test post content</p>",
		created_at: 1711540800,
		is_first: 1,
		position: 1,
		...overrides,
	};
}

export function makeD1UserRow(overrides?: Record<string, unknown>) {
	return {
		id: 123,
		username: "testuser",
		email: "test@example.com",
		avatar: "avatar.png",
		status: 0,
		role: 0,
		reg_date: 1711540800,
		last_login: 1711544400,
		threads: 10,
		posts: 50,
		credits: 100,
		...overrides,
	};
}

// ─── JWT Helpers ───────────────────────────────────────────

export async function createJwtForRole(
	role: number,
	userId = 1,
	secret = TEST_JWT_SECRET,
): Promise<string> {
	return createJwt(
		{
			userId,
			role,
			exp: Math.floor(Date.now() / 1000) + 3600,
		},
		secret,
	);
}

// ─── Request Factories ─────────────────────────────────────

export async function createAdminRequest(
	method: string,
	path: string,
	body?: unknown,
	role = 1, // Admin by default
	userId = 1,
): Promise<Request> {
	const token = await createJwtForRole(role, userId);
	const headers: Record<string, string> = {
		"X-API-Key": TEST_API_KEY,
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
	return new Request(`https://api.example.com${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

// ─── Mock DB Builder ───────────────────────────────────────

/**
 * Create a configurable mock D1Database that tracks SQL calls.
 *
 * Usage:
 *   const { db, calls } = createMockDb({
 *     firstResults: { "SELECT * FROM forums WHERE id": makeD1ForumRow() },
 *     allResults: { "SELECT * FROM forums ORDER": [makeD1ForumRow()] },
 *   });
 */
export function createMockDb(config?: {
	/** Map of SQL substring -> result for .first() calls */
	firstResults?: Record<string, unknown>;
	/** Map of SQL substring -> results array for .all() calls */
	allResults?: Record<string, unknown[]>;
	/** Map of SQL substring -> result for .run() calls */
	runResults?: Record<string, unknown>;
}) {
	const calls: { sql: string; params: unknown[] }[] = [];
	const batchCalls: unknown[][] = [];

	const db = {
		prepare: mock((sql: string) => {
			return {
				bind: mock((...params: unknown[]) => {
					calls.push({ sql, params });
					return {
						first: mock(async () => {
							if (config?.firstResults) {
								for (const [key, val] of Object.entries(config.firstResults)) {
									if (sql.includes(key)) return val;
								}
							}
							return null;
						}),
						all: mock(async () => {
							if (config?.allResults) {
								for (const [key, val] of Object.entries(config.allResults)) {
									if (sql.includes(key)) return { results: val };
								}
							}
							return { results: [] };
						}),
						run: mock(async () => {
							if (config?.runResults) {
								for (const [key, val] of Object.entries(config.runResults)) {
									if (sql.includes(key)) return val;
								}
							}
							return { success: true, meta: { last_row_id: 1, changes: 1 } };
						}),
					};
				}),
				// Also support parameterless calls
				first: mock(async () => {
					calls.push({ sql, params: [] });
					if (config?.firstResults) {
						for (const [key, val] of Object.entries(config.firstResults)) {
							if (sql.includes(key)) return val;
						}
					}
					return null;
				}),
				all: mock(async () => {
					calls.push({ sql, params: [] });
					if (config?.allResults) {
						for (const [key, val] of Object.entries(config.allResults)) {
							if (sql.includes(key)) return { results: val };
						}
					}
					return { results: [] };
				}),
				run: mock(async () => {
					calls.push({ sql, params: [] });
					if (config?.runResults) {
						for (const [key, val] of Object.entries(config.runResults)) {
							if (sql.includes(key)) return val;
						}
					}
					return { success: true, meta: { last_row_id: 1, changes: 1 } };
				}),
			} as unknown as D1PreparedStatement;
		}),
		batch: mock(async (stmts: unknown[]) => {
			batchCalls.push(stmts);
			return stmts.map(() => ({ success: true, results: [] }));
		}),
	} as unknown as D1Database;

	return { db, calls, batchCalls };
}
