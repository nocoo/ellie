import { UserRole } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import * as postHandler from "../../../src/handlers/post";
import type { Env } from "../../../src/lib/env";
import { createJwtForRole, createMockKV, makeD1PostRow, TEST_JWT_SECRET } from "../../helpers";

const THREAD_AUTHOR_ID = 100;
const FORUM_MOD_ID = 200;
const OTHER_USER_ID = 300;

function createMockDb(opts: {
	visRow: Record<string, unknown> | null;
	posts?: unknown[];
	userRole?: number;
	userStatus?: number;
}) {
	return {
		prepare: vi.fn((sql: string) => {
			if (
				sql.includes("FROM posts") &&
				sql.includes("JOIN threads") &&
				sql.includes("JOIN forums")
			) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() => Promise.resolve(opts.visRow)),
						all: vi.fn(() => Promise.resolve({ results: opts.posts ?? [makeD1PostRow()] })),
					})),
				};
			}
			if (sql.includes("FROM threads") && sql.includes("JOIN forums")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() => Promise.resolve(opts.visRow)),
					})),
				};
			}
			if (sql.includes("SELECT role, status FROM users")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() =>
							Promise.resolve(
								opts.userRole !== undefined
									? { role: opts.userRole, status: opts.userStatus ?? 0 }
									: null,
							),
						),
					})),
				};
			}
			if (sql.includes("FROM posts WHERE thread_id")) {
				return {
					bind: vi.fn(() => ({
						all: vi.fn(() => Promise.resolve({ results: opts.posts ?? [makeD1PostRow()] })),
					})),
				};
			}
			if (sql.includes("FROM posts WHERE id")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() => Promise.resolve(opts.posts?.[0] ?? makeD1PostRow())),
					})),
				};
			}
			if (sql.includes("post_ratings")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() => Promise.resolve(null)),
						all: vi.fn(() => Promise.resolve({ results: [] })),
					})),
				};
			}
			return {
				bind: vi.fn(() => ({
					first: vi.fn(() => Promise.resolve(null)),
					all: vi.fn(() => Promise.resolve({ results: [] })),
					run: vi.fn(() => Promise.resolve({ success: true })),
				})),
			};
		}),
	} as unknown as D1Database;
}

function makeEnv(db: D1Database): Env {
	return {
		API_KEY: "test-api-key",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
		USE_KV_USER_CACHE: "false",
	} as unknown as Env;
}

function createCreateMockDb(): D1Database {
	const lookup: Record<string, unknown> = {
		"SELECT role, status FROM users": { role: UserRole.User, status: 0 },
		email_verified_at: { role: UserRole.User, status: 0, email_verified_at: 1000 },
		"MAX(position)": { maxPos: 5 },
		"SELECT username FROM users": { username: "alice" },
	};
	return {
		prepare: vi.fn((sql: string) => {
			for (const [key, val] of Object.entries(lookup)) {
				if (sql.includes(key)) {
					return { bind: vi.fn(() => ({ first: vi.fn(() => Promise.resolve(val)) })) };
				}
			}
			if (sql.includes("avatar_path") && sql.includes("has_avatar")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() =>
							Promise.resolve({
								status: 0,
								avatar_path: "a.jpg",
								has_avatar: 1,
								reg_date: 1000000,
								role: 0,
							}),
						),
					})),
				};
			}
			if (sql.includes("settings") || sql.includes("censor_words")) {
				return {
					all: vi.fn(() => Promise.resolve({ results: [] })),
					bind: vi.fn(() => ({ all: vi.fn(() => Promise.resolve({ results: [] })) })),
				};
			}
			if (sql.includes("FROM threads") && sql.includes("JOIN forums")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() =>
							Promise.resolve({
								id: 1,
								forum_id: 1,
								closed: 0,
								sticky: -2,
								status: 1,
								visibility: "public",
							}),
						),
					})),
				};
			}
			return {
				bind: vi.fn(() => ({
					first: vi.fn(() => Promise.resolve(null)),
					all: vi.fn(() => Promise.resolve({ results: [] })),
					run: vi.fn(() => Promise.resolve({ success: true })),
				})),
			};
		}),
	} as unknown as D1Database;
}

describe("post.list — moderated thread (sticky=-2) visibility", () => {
	const visRow = {
		forum_id: 1,
		sticky: -2,
		author_id: THREAD_AUTHOR_ID,
		status: 1,
		visibility: "public",
		moderator_ids: `${FORUM_MOD_ID}`,
	};

	it("anonymous user gets 404 for posts in moderated thread", async () => {
		const db = createMockDb({ visRow });
		const req = new Request("https://x.com/api/v1/posts?threadId=1");
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("non-author regular user gets 404", async () => {
		const jwt = await createJwtForRole(UserRole.User, OTHER_USER_ID);
		const db = createMockDb({ visRow, userRole: UserRole.User });
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("thread author can list posts", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({ visRow, userRole: UserRole.User });
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("forum moderator can list posts", async () => {
		const jwt = await createJwtForRole(UserRole.Mod, FORUM_MOD_ID);
		const db = createMockDb({ visRow, userRole: UserRole.Mod });
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("admin can list posts", async () => {
		const jwt = await createJwtForRole(UserRole.Admin, 999);
		const db = createMockDb({ visRow, userRole: UserRole.Admin });
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("returns 404 when forum is inactive for moderated thread", async () => {
		const db = createMockDb({
			visRow: { ...visRow, status: 0 },
		});
		const req = new Request("https://x.com/api/v1/posts?threadId=1");
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("returns 403 when visibility denies access (staff forum, logged-in non-staff)", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow: { ...visRow, sticky: 0, visibility: "staff" },
			userRole: UserRole.User,
		});
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(403);
	});

	it("thread author can list posts even on staff-only forum when moderated", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow: { ...visRow, visibility: "staff" },
			userRole: UserRole.User,
		});
		const req = new Request("https://x.com/api/v1/posts?threadId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});
});

describe("post.getById — moderated thread (sticky=-2) visibility", () => {
	const visRow = {
		forum_id: 1,
		sticky: -2,
		author_id: THREAD_AUTHOR_ID,
		status: 1,
		visibility: "public",
		moderator_ids: `${FORUM_MOD_ID}`,
	};

	it("anonymous user gets 404 for post in moderated thread", async () => {
		const db = createMockDb({ visRow, posts: [makeD1PostRow({ thread_id: 1 })] });
		const req = new Request("https://x.com/api/v1/posts/1");
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("thread author can view post", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow,
			userRole: UserRole.User,
			posts: [makeD1PostRow({ thread_id: 1 })],
		});
		const req = new Request("https://x.com/api/v1/posts/1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("supermod can view post", async () => {
		const jwt = await createJwtForRole(UserRole.SuperMod, 888);
		const db = createMockDb({
			visRow,
			userRole: UserRole.SuperMod,
			posts: [makeD1PostRow({ thread_id: 1 })],
		});
		const req = new Request("https://x.com/api/v1/posts/1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("returns 404 when forum inactive on moderated thread getById", async () => {
		const db = createMockDb({
			visRow: { ...visRow, status: 0 },
			posts: [makeD1PostRow({ thread_id: 1 })],
		});
		const req = new Request("https://x.com/api/v1/posts/1");
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("returns 403 on staff-only forum for non-staff in getById", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow: { ...visRow, sticky: 0, visibility: "staff" },
			userRole: UserRole.User,
			posts: [makeD1PostRow({ thread_id: 1 })],
		});
		const req = new Request("https://x.com/api/v1/posts/1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(403);
	});

	it("thread author can view post on staff-only forum when moderated", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow: { ...visRow, visibility: "staff" },
			userRole: UserRole.User,
			posts: [makeD1PostRow({ thread_id: 1 })],
		});
		const req = new Request("https://x.com/api/v1/posts/1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postHandler.getById(req, makeEnv(db));
		expect(response.status).toBe(200);
	});
});

describe("post.create — rejects replies to moderated threads", () => {
	it("returns 404 when thread is sticky=-2", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createCreateMockDb();

		const req = new Request("https://x.com/api/v1/posts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ threadId: 1, content: "test reply" }),
		});
		const env = makeEnv(db);
		const response = await postHandler.create(req, env);
		expect(response.status).toBe(404);
	});
});
