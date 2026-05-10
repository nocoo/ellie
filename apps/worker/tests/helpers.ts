// Shared test utilities for Cloudflare Worker tests

import { vi } from "vitest";
import type { Env } from "../src/lib/env";

// ─── Constants ─────────────────────────────────────────────
export const TEST_API_KEY = "test-api-key";
export const TEST_ADMIN_API_KEY = "test-admin-api-key";
export const TEST_JWT_SECRET = "test-secret-key-for-jwt-hs256";

// ─── Env Factory ───────────────────────────────────────────

/**
 * Create a mock KVNamespace for testing.
 * Returns a simple in-memory store with get/put/delete methods.
 */
export function createMockKV(initialData: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initialData));
	return {
		get: vi.fn(async (key: string, type?: string) => {
			const raw = store.get(key) ?? null;
			if (raw === null) return null;
			if (type === "json") {
				try {
					return JSON.parse(raw);
				} catch {
					return null;
				}
			}
			return raw;
		}),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
		getWithMetadata: vi.fn(async (key: string) => ({
			value: store.get(key) ?? null,
			metadata: null,
		})),
		// Minimal `list` — returns all keys whose name starts with `prefix`,
		// sorted by name (Cloudflare KV is byte-ordered). Pagination is
		// honored if `limit` is provided. `cursor` is the next start key.
		list: vi.fn(async (opts: { prefix?: string; cursor?: string; limit?: number } = {}) => {
			const prefix = opts.prefix ?? "";
			const limit = opts.limit ?? 1000;
			const all = Array.from(store.keys())
				.filter((k) => k.startsWith(prefix))
				.sort();
			const startIdx = opts.cursor
				? Math.max(
						0,
						all.findIndex((k) => k > (opts.cursor as string)),
					)
				: 0;
			const slice = all.slice(startIdx, startIdx + limit);
			const list_complete = startIdx + slice.length >= all.length;
			return {
				keys: slice.map((name) => ({ name, expiration: undefined })),
				list_complete,
				cursor: list_complete ? "" : slice[slice.length - 1],
			};
		}),
	} as unknown as KVNamespace;
}

/**
 * Create a mock ExecutionContext for testing.
 * waitUntil() is a no-op that collects promises for inspection.
 */
export function createMockCtx() {
	const waitUntilPromises: Promise<unknown>[] = [];
	return {
		waitUntil: vi.fn((promise: Promise<unknown>) => {
			waitUntilPromises.push(promise);
		}),
		passThroughOnException: vi.fn(() => {}),
		_waitUntilPromises: waitUntilPromises,
	} as unknown as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
}

export function makeEnv(overrides?: Partial<Env>): Env {
	return {
		API_KEY: TEST_API_KEY,
		ADMIN_API_KEY: TEST_ADMIN_API_KEY,
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
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
		visibility: "public",
		moderators: "",
		last_thread_id: 42,
		last_post_at: 1711540800,
		last_poster: "alice",
		last_poster_id: 10,
		last_thread_subject: "Latest Thread",
		// JOIN result field (for JOIN approach)
		last_poster_avatar: "",
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
		last_poster_id: 20,
		replies: 5,
		views: 100,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		type_name: "",
		post_table_id: 1, // internal field — should NOT appear in output
		is_author_first_thread: 0, // derived column — default not first thread
		// JOIN result fields (for JOIN approach)
		author_avatar: "",
		last_poster_avatar: "",
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
		avatar_path: "avatars/test.jpg",
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

export function makeD1AttachmentRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		thread_id: 1,
		post_id: 1,
		author_id: 10,
		filename: "test.jpg",
		file_path: "/attachments/test.jpg",
		file_size: 12345,
		is_image: 1,
		width: 800,
		has_thumb: 1,
		downloads: 0,
		created_at: 1711540800,
		...overrides,
	};
}

// ─── JWT Helpers ───────────────────────────────────────────
// Kept for non-admin tests that still use JWT auth (e.g., public API endpoints)

import { createJwt } from "../src/lib/jwt";

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

/**
 * Create an admin request with X-API-Key header.
 * Admin endpoints are authenticated by Key B at the router level — no JWT needed.
 */
export function createAdminRequest(method: string, path: string, body?: unknown): Request {
	const headers: Record<string, string> = {
		"X-API-Key": TEST_ADMIN_API_KEY,
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
		prepare: vi.fn((sql: string) => {
			return {
				bind: vi.fn((...params: unknown[]) => {
					calls.push({ sql, params });
					return {
						first: vi.fn(async () => {
							if (config?.firstResults) {
								for (const [key, val] of Object.entries(config.firstResults)) {
									if (sql.includes(key)) return val;
								}
							}
							return null;
						}),
						all: vi.fn(async () => {
							if (config?.allResults) {
								for (const [key, val] of Object.entries(config.allResults)) {
									if (sql.includes(key)) return { results: val };
								}
							}
							return { results: [] };
						}),
						run: vi.fn(async () => {
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
				first: vi.fn(async () => {
					calls.push({ sql, params: [] });
					if (config?.firstResults) {
						for (const [key, val] of Object.entries(config.firstResults)) {
							if (sql.includes(key)) return val;
						}
					}
					return null;
				}),
				all: vi.fn(async () => {
					calls.push({ sql, params: [] });
					if (config?.allResults) {
						for (const [key, val] of Object.entries(config.allResults)) {
							if (sql.includes(key)) return { results: val };
						}
					}
					return { results: [] };
				}),
				run: vi.fn(async () => {
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
		batch: vi.fn(async (stmts: unknown[]) => {
			batchCalls.push(stmts);
			return stmts.map(() => ({
				success: true,
				results: [],
				meta: { changes: 1, last_row_id: 1 },
			}));
		}),
	} as unknown as D1Database;

	return { db, calls, batchCalls };
}

/**
 * Create a mock R2Bucket for testing.
 * Provides basic put/get/delete methods with optional behavior overrides.
 */
export function createMockR2(config?: {
	/** Throw error on put */
	putError?: Error;
	/** Stored objects (key -> ArrayBuffer) */
	objects?: Map<string, ArrayBuffer>;
}) {
	const store = config?.objects ?? new Map<string, ArrayBuffer>();
	const metaStore = new Map<string, { httpMetadata?: { contentType?: string } }>();
	const putCalls: {
		key: string;
		body: ArrayBuffer;
		options?: { httpMetadata?: { contentType?: string } };
	}[] = [];
	return {
		put: vi.fn(
			async (
				key: string,
				body: ArrayBuffer | ReadableStream | string,
				options?: { httpMetadata?: { contentType?: string } },
			) => {
				if (config?.putError) throw config.putError;
				const buffer =
					body instanceof ArrayBuffer ? body : new TextEncoder().encode(body as string).buffer;
				store.set(key, buffer as ArrayBuffer);
				if (options) metaStore.set(key, options);
				putCalls.push({ key, body: buffer as ArrayBuffer, options });
				return { key, size: (buffer as ArrayBuffer).byteLength };
			},
		),
		get: vi.fn(async (key: string) => {
			const data = store.get(key);
			if (!data) return null;
			const meta = metaStore.get(key);
			return {
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(data));
						controller.close();
					},
				}),
				arrayBuffer: async () => data,
				httpMetadata: meta?.httpMetadata,
			};
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
		_putCalls: putCalls,
	} as unknown as R2Bucket & {
		_putCalls: {
			key: string;
			body: ArrayBuffer;
			options?: { httpMetadata?: { contentType?: string } };
		}[];
	};
}
