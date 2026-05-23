import { UserRole } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";

// Bypass the v2 forum-meta gate: these tests focus on moderated-thread
// visibility, not the forum cache layer.
vi.mock("../../../src/lib/cache/forum-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/forum-read",
	);
	return {
		...actual,
		getForumMetaV2: vi.fn(async (_env, _ctx, id: number) => ({
			kind: "ok",
			forum: { id, status: 1, visibility: "public", name: "F" },
		})),
	};
});

vi.mock("../../../src/lib/cache/thread-list-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/thread-list-read",
	);
	return {
		...actual,
		getThreadListPageOneV2: vi.fn(
			async (_env, _ctx, _forumId, _limit, loader: () => Promise<unknown>) => loader(),
		),
	};
});

import { getById } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import {
	TEST_JWT_SECRET,
	createJwtForRole,
	createMockCtx,
	createMockKV,
	makeD1ThreadRow,
} from "../../helpers";

const THREAD_AUTHOR_ID = 100;
const FORUM_MOD_ID = 200;
const OTHER_USER_ID = 300;
const FORUM_ID = 10;

function makeModeratedThread(overrides?: Record<string, unknown>) {
	return makeD1ThreadRow({
		id: 1169047,
		forum_id: FORUM_ID,
		author_id: THREAD_AUTHOR_ID,
		sticky: -2,
		...overrides,
	});
}

function createMockDbForModerated(opts: {
	threadRow: unknown | null;
	forumModeratorIds?: string;
	userRole?: number;
	userStatus?: number;
}) {
	return {
		prepare: vi.fn((sql: string) => {
			if (sql.includes("FROM threads") && sql.includes("WHERE")) {
				return {
					bind: vi.fn((..._args: unknown[]) => ({
						first: vi.fn(() => Promise.resolve(opts.threadRow)),
					})),
				};
			}
			if (sql.includes("FROM forums WHERE id")) {
				return {
					bind: vi.fn(() => ({
						first: vi.fn(() =>
							Promise.resolve({
								status: 1,
								visibility: "public",
								moderator_ids: opts.forumModeratorIds ?? "",
							}),
						),
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
			if (sql.includes("UPDATE threads SET views")) {
				return {
					bind: vi.fn((..._args: unknown[]) => ({
						run: vi.fn(() => Promise.resolve({ success: true })),
					})),
				};
			}
			return {
				bind: vi.fn((..._args: unknown[]) => ({
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
	};
}

async function makeRequest(jwt?: string) {
	const headers: Record<string, string> = {};
	if (jwt) headers.Authorization = `Bearer ${jwt}`;
	return new Request("https://example.com/api/v1/threads/1169047", { headers });
}

describe("thread detail — moderated (sticky=-2) visibility", () => {
	it("anonymous user gets 404 for moderated thread", async () => {
		const db = createMockDbForModerated({ threadRow: makeModeratedThread() });
		const response = await getById(await makeRequest(), makeEnv(db), createMockCtx());

		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.error.code).toBe("THREAD_NOT_FOUND");
	});

	it("non-author regular user gets 404 for moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.User, OTHER_USER_ID);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			userRole: UserRole.User,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.error.code).toBe("THREAD_NOT_FOUND");
	});

	it("thread author can view their own moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.User, THREAD_AUTHOR_ID);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			userRole: UserRole.User,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.id).toBe(1169047);
		expect(data.data.moderationStatus).toBe("pending_review");
	});

	it("forum moderator (in moderator_ids) can view moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.Mod, FORUM_MOD_ID);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			forumModeratorIds: `${FORUM_MOD_ID},999`,
			userRole: UserRole.Mod,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.moderationStatus).toBe("pending_review");
	});

	it("forum moderator NOT in moderator_ids gets 404", async () => {
		const jwt = await createJwtForRole(UserRole.Mod, FORUM_MOD_ID);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			forumModeratorIds: "999,888",
			userRole: UserRole.Mod,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.error.code).toBe("THREAD_NOT_FOUND");
	});

	it("super moderator can view any moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.SuperMod, 500);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			userRole: UserRole.SuperMod,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.moderationStatus).toBe("pending_review");
	});

	it("admin can view any moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.Admin, 600);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			userRole: UserRole.Admin,
		});
		const response = await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.moderationStatus).toBe("pending_review");
	});

	it("normal thread (sticky=0) does NOT have moderationStatus field", async () => {
		const normalThread = makeD1ThreadRow({ id: 42, forum_id: FORUM_ID, sticky: 0 });
		const db = createMockDbForModerated({ threadRow: normalThread });
		const response = await getById(await makeRequest(), makeEnv(db), createMockCtx());

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.moderationStatus).toBeUndefined();
	});

	it("does not increment view count for moderated thread", async () => {
		const jwt = await createJwtForRole(UserRole.Admin, 600);
		const db = createMockDbForModerated({
			threadRow: makeModeratedThread(),
			userRole: UserRole.Admin,
		});
		await getById(await makeRequest(jwt), makeEnv(db), createMockCtx());

		const updateCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
			(c[0] as string).includes("UPDATE threads SET views"),
		);
		expect(updateCall).toBeUndefined();
	});

	it("other negative sticky values (e.g. -1, -3) still return 404 (SQL excludes them)", async () => {
		const db = createMockDbForModerated({ threadRow: null });
		const response = await getById(await makeRequest(), makeEnv(db), createMockCtx());

		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.error.code).toBe("THREAD_NOT_FOUND");
	});
});
