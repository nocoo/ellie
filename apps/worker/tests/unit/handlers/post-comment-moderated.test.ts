import { UserRole } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import * as postCommentHandler from "../../../src/handlers/post-comment";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, createJwtForRole, createMockKV } from "../../helpers";

const THREAD_AUTHOR_ID = 100;
const FORUM_MOD_ID = 200;
const OTHER_USER_ID = 300;

function createMockDb(opts: {
	visRow: Record<string, unknown> | null;
	userRole?: number;
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
								opts.userRole !== undefined ? { role: opts.userRole, status: 0 } : null,
							),
						),
					})),
				};
			}
			if (sql.includes("FROM post_comments")) {
				return {
					bind: vi.fn(() => ({
						all: vi.fn(() => Promise.resolve({ results: [] })),
					})),
				};
			}
			return {
				bind: vi.fn(() => ({
					first: vi.fn(() => Promise.resolve(null)),
					all: vi.fn(() => Promise.resolve({ results: [] })),
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

describe("post-comment.list — moderated thread (sticky=-2) visibility", () => {
	const visRow = {
		forum_id: 1,
		sticky: -2,
		author_id: THREAD_AUTHOR_ID,
		status: 1,
		visibility: "public",
		moderator_ids: `${FORUM_MOD_ID}`,
	};

	it("anonymous user gets 404 for comments on moderated thread post", async () => {
		const db = createMockDb({ visRow });
		const req = new Request("https://x.com/api/v1/post-comments?postId=1");
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("non-author regular user gets 404", async () => {
		const jwt = await createJwtForRole(UserRole.User, OTHER_USER_ID);
		const db = createMockDb({ visRow, userRole: UserRole.User });
		const req = new Request("https://x.com/api/v1/post-comments?postId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("thread author can list comments", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({ visRow, userRole: UserRole.User });
		const req = new Request("https://x.com/api/v1/post-comments?postId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("admin can list comments", async () => {
		const jwt = await createJwtForRole(UserRole.Admin, 999);
		const db = createMockDb({ visRow, userRole: UserRole.Admin });
		const req = new Request("https://x.com/api/v1/post-comments?postId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(200);
	});

	it("returns 403 on staff-only forum for non-staff user", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({
			visRow: { ...visRow, sticky: 0, visibility: "staff" },
			userRole: UserRole.User,
		});
		const req = new Request("https://x.com/api/v1/post-comments?postId=1", {
			headers: { Authorization: `Bearer ${jwt}` },
		});
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(403);
	});

	it("returns 404 when forum is inactive", async () => {
		const db = createMockDb({
			visRow: { ...visRow, status: 0 },
		});
		const req = new Request("https://x.com/api/v1/post-comments?postId=1");
		const response = await postCommentHandler.list(req, makeEnv(db));
		expect(response.status).toBe(404);
	});
});

describe("post-comment.batchByPostIds — moderated thread (sticky=-2) visibility", () => {
	const visRow = {
		forum_id: 1,
		sticky: -2,
		author_id: THREAD_AUTHOR_ID,
		status: 1,
		visibility: "public",
		moderator_ids: `${FORUM_MOD_ID}`,
	};

	it("anonymous user gets 404 for batch on moderated thread", async () => {
		const db = createMockDb({ visRow });
		const req = new Request("https://x.com/api/v1/post-comments/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ threadId: 1, postIds: [1, 2] }),
		});
		const response = await postCommentHandler.batchByPostIds(req, makeEnv(db));
		expect(response.status).toBe(404);
	});

	it("thread author can batch-fetch comments", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDb({ visRow, userRole: UserRole.User });
		const req = new Request("https://x.com/api/v1/post-comments/batch", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ threadId: 1, postIds: [1, 2] }),
		});
		const response = await postCommentHandler.batchByPostIds(req, makeEnv(db));
		expect(response.status).toBe(200);
	});
});
