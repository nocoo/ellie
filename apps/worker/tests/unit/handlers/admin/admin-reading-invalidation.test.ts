import type { CacheDescriptor, User } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as users from "../../../../src/handlers/admin/user";
import { adminEntityCacheKey, readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { buildContentRecalcStatements } from "../../../../src/lib/recalcMetadata";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

function detail(entity: string, id: number): CacheDescriptor {
	return { family: "admin:entity:detail", params: { entity, id }, scope: "admin" };
}

function list(entity: string, query = "limit=20&page=1"): CacheDescriptor {
	return { family: "admin:entity:list", params: { entity, query }, scope: "admin" };
}

const staff: CacheDescriptor = { family: "admin:users:staff", params: {}, scope: "admin" };
const unrelated = detail("censor_words", 1);
type UserList = { items: User[]; total: number };

const actions = [
	{
		name: "ban",
		handler: users.ban,
		path: "/api/admin/users/30/ban",
		body: {},
		ids: [30],
		column: "status",
		previous: 0,
		next: -1,
	},
	{
		name: "unban",
		handler: users.unban,
		path: "/api/admin/users/30/unban",
		body: {},
		ids: [30],
		column: "status",
		previous: -1,
		next: 0,
	},
	{
		name: "batch status",
		handler: users.batchStatus,
		path: "/api/admin/users/batch-status",
		body: { ids: [10, 20], status: -2 },
		ids: [10, 20],
		column: "status",
		previous: 0,
		next: -2,
	},
	{
		name: "batch role",
		handler: users.batchRole,
		path: "/api/admin/users/batch-role",
		body: { ids: [10, 20], role: 3 },
		ids: [10, 20],
		column: "role",
		previous: 0,
		next: 3,
	},
] as const;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.insert("censor_words", {
		id: 1,
		find: "unchanged",
		replacement: "**",
		action: "replace",
		admin_id: 1,
		admin_name: "admin",
		created_at: 1,
	});
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	vi.restoreAllMocks();
	f.close();
	vi.useRealTimers();
});

function seedAction(action: (typeof actions)[number]) {
	f.sqlite
		.prepare(`UPDATE users SET ${action.column} = ? WHERE id IN (SELECT value FROM json_each(?))`)
		.run(action.previous, JSON.stringify(action.ids));
}

async function warm<T = unknown>(descriptor: CacheDescriptor) {
	const data = await readAdminEntity<T>(f.env, undefined, descriptor);
	const key = await adminEntityCacheKey(f.env, descriptor);
	expect(f.values.has(key)).toBe(true);
	const queries = f.calls.length;
	expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(data);
	expect(f.calls).toHaveLength(queries);
	return { descriptor, key, data };
}

async function warmMany<T = unknown>(descriptors: readonly CacheDescriptor[]) {
	const snapshots: Awaited<ReturnType<typeof warm<T>>>[] = [];
	// Each hot-read budget must exclude other descriptors' cold SQL.
	for (const descriptor of descriptors) snapshots.push(await warm<T>(descriptor));
	return snapshots;
}

async function expectStillWarm(snapshot: Awaited<ReturnType<typeof warm>>) {
	const queries = f.calls.length;
	expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).toBe(snapshot.key);
	expect(await readAdminEntity(f.env, undefined, snapshot.descriptor)).toEqual(snapshot.data);
	expect(f.calls).toHaveLength(queries);
}

/** Intercept only the mutation boundary; all gates and cached loaders use SQLite. */
function userWrites(run: (statement: D1PreparedStatement) => Promise<D1Result>) {
	const write = vi.fn(run);
	const prepare = f.env.DB.prepare.bind(f.env.DB);
	vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
		const statement = prepare(sql);
		if (!/^\s*UPDATE users SET (status|role)\b/.test(sql)) return statement;
		return {
			...statement,
			bind: (...args: Parameters<D1PreparedStatement["bind"]>) => {
				const bound = statement.bind(...args);
				return { ...bound, run: () => write(bound) } as D1PreparedStatement;
			},
		};
	});
	return write;
}

describe("confirmed Admin user mutations refresh scoped reading caches", () => {
	it.each(actions)(
		"$name refreshes detail, filtered lists and staff without cooling other resources",
		async (action) => {
			seedAction(action);
			const details = await warmMany<User>(action.ids.map((id) => detail("users", id)));
			const beforeList = await warm<UserList>(
				list("users", `limit=20&page=1&${action.column}=${action.previous}`),
			);
			const afterList = await warm<UserList>(
				list("users", `limit=20&page=1&${action.column}=${action.next}`),
			);
			const staffSnapshot = await warm<User[]>(staff);
			const other = await warm(unrelated);
			expect(beforeList.data.items.map((row) => row.id)).toEqual(
				expect.arrayContaining([...action.ids]),
			);
			expect(afterList.data.items.some((row) => action.ids.some((id) => id === row.id))).toBe(
				false,
			);

			const response = await action.handler(
				createAdminRequest("POST", action.path, action.body),
				f.env,
			);
			expect(response.status).toBe(200);
			await expectStillWarm(other);
			for (const snapshot of details) {
				const stored = f.sqlite
					.prepare(`SELECT ${action.column} FROM users WHERE id = ?`)
					.get(snapshot.data.id);
				expect(stored?.[action.column]).toBe(action.next);
				const read = await users.getById(
					createAdminRequest("GET", `/api/admin/users/${snapshot.data.id}`),
					f.env,
				);
				expect(read.status).toBe(200);
				expect(((await read.json()) as { data: User }).data[action.column]).toBe(action.next);
			}
			const beforeRows = await readAdminEntity<UserList>(f.env, undefined, beforeList.descriptor);
			const afterRows = await readAdminEntity<UserList>(f.env, undefined, afterList.descriptor);
			expect(beforeRows.items.some((row) => action.ids.some((id) => id === row.id))).toBe(false);
			expect(beforeRows.total).toBe(beforeList.data.total - action.ids.length);
			expect(afterRows.items.map((row) => row.id)).toEqual(expect.arrayContaining([...action.ids]));
			expect(afterRows.total).toBe(afterList.data.total + action.ids.length);
			const staffRead = await users.listStaff(
				createAdminRequest("GET", "/api/admin/users/staff"),
				f.env,
			);
			expect(staffRead.status).toBe(200);
			expect(((await staffRead.json()) as { data: User[] }).data).toMatchObject(
				f.sqlite
					.prepare(
						"SELECT id, status, role FROM users WHERE role > 0 ORDER BY role ASC, username ASC",
					)
					.all(),
			);

			const queries = f.calls.length;
			for (const snapshot of [...details, beforeList, afterList, staffSnapshot]) {
				expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).not.toBe(snapshot.key);
				await readAdminEntity(f.env, undefined, snapshot.descriptor);
			}
			expect(f.calls).toHaveLength(queries);
		},
	);

	it("successive ban and unban change the canonical version twice within the same TTL", async () => {
		const descriptor = detail("users", 30);
		const original = await warm<User>(descriptor);
		await users.ban(createAdminRequest("POST", "/api/admin/users/30/ban"), f.env);
		const banned = await warm<User>(descriptor);
		expect(banned.data.status).toBe(-1);
		await users.unban(createAdminRequest("POST", "/api/admin/users/30/unban"), f.env);
		const restored = await warm<User>(descriptor);
		expect(restored.data.status).toBe(0);
		expect(new Set([original.key, banned.key, restored.key]).size).toBe(3);
	});
});

describe.each(["unconfirmed", "SQLite error"] as const)(
	"Admin writes with %s results",
	(failure) => {
		it.each(actions)("$name leaves warmed resource versions and data intact", async (action) => {
			seedAction(action);
			const snapshots = await warmMany([
				...action.ids.map((id) => detail("users", id)),
				list("users"),
				staff,
				unrelated,
			]);
			if (failure === "SQLite error") {
				f.sqlite.exec(`CREATE TRIGGER reject_admin_user_write BEFORE UPDATE ON users
				BEGIN SELECT RAISE(ABORT, 'forced admin write failure'); END`);
			}
			const write = userWrites(async (statement) =>
				failure === "unconfirmed"
					? ({ success: false, results: [], meta: { changes: 1 } } as unknown as D1Result)
					: statement.run(),
			);
			await expect(
				action.handler(createAdminRequest("POST", action.path, action.body), f.env),
			).rejects.toThrow(
				failure === "unconfirmed" ? "D1 write was not confirmed" : "forced admin write failure",
			);
			expect(write).toHaveBeenCalledTimes(1);
			for (const id of action.ids) {
				expect(
					f.sqlite.prepare(`SELECT ${action.column} FROM users WHERE id = ?`).get(id)?.[
						action.column
					],
				).toBe(action.previous);
			}
			for (const snapshot of snapshots) await expectStillWarm(snapshot);
		});
	},
);

describe("zero-row Admin writes do not publish a resource epoch", () => {
	it.each(actions)("$name preserves warm entries when D1 confirms zero changes", async (action) => {
		seedAction(action);
		const snapshots = await warmMany([
			...action.ids.map((id) => detail("users", id)),
			list("users"),
			staff,
			unrelated,
		]);
		const batch = action.path.includes("/batch-");
		if (!batch) {
			f.sqlite.exec(`CREATE TRIGGER ignore_admin_user_write BEFORE UPDATE ON users
				BEGIN SELECT RAISE(IGNORE); END`);
		}
		const body = batch ? { ...action.body, ids: [99_999] } : action.body;
		const write = userWrites((statement) => statement.run());
		const response = await action.handler(createAdminRequest("POST", action.path, body), f.env);
		expect(response.status).toBe(200);
		expect(write).toHaveBeenCalledTimes(1);
		expect(await write.mock.results[0].value).toMatchObject({
			success: true,
			meta: { changes: 0 },
		});
		for (const snapshot of snapshots) await expectStillWarm(snapshot);
	});
});

it("ban with content cleanup refreshes deleted entities, survivor metadata and collateral user counts", async () => {
	f.thread(1);
	f.post(1);
	f.post(2, { author_id: 20, author_name: "bob" });
	f.thread(2, { forum_id: 2, author_id: 20, author_name: "bob" });
	f.post(3, {
		thread_id: 2,
		forum_id: 2,
		author_id: 20,
		author_name: "bob",
		is_first: 1,
		position: 1,
	});
	f.post(4, { thread_id: 2, forum_id: 2, position: 2 });
	for (const [id, postId, threadId, authorId] of [
		[1, 1, 1, 10],
		[2, 2, 1, 20],
		[3, 4, 2, 10],
	]) {
		f.insert("attachments", {
			id,
			post_id: postId,
			thread_id: threadId,
			author_id: authorId,
			filename: `asset-${id}.png`,
			file_path: `assets/${id}.png`,
		});
	}
	await f.env.DB.batch(buildContentRecalcStatements(f.env, [1, 2], [1, 2]));
	f.sqlite.exec(`UPDATE users SET
		threads = (SELECT COUNT(*) FROM threads WHERE author_id = users.id),
		posts = (SELECT COUNT(*) FROM posts WHERE author_id = users.id)`);
	const targets = [
		{ descriptor: detail("users", 10), expected: { id: 10, status: -1, threads: 0, posts: 0 } },
		{ descriptor: detail("users", 20), expected: { id: 20, threads: 1, posts: 1 } },
		{ descriptor: detail("threads", 1), expected: null },
		{ descriptor: detail("threads", 2), expected: { id: 2, replies: 0, lastPostAt: 3 } },
		{ descriptor: detail("posts", 1), expected: null },
		{ descriptor: detail("posts", 2), expected: null },
		{ descriptor: detail("posts", 4), expected: null },
		{ descriptor: detail("attachments", 1), expected: null },
		{ descriptor: detail("forums", 1), expected: { id: 1, threads: 0, posts: 0 } },
		{ descriptor: detail("forums", 2), expected: { id: 2, threads: 1, posts: 1 } },
		{ descriptor: list("threads"), expected: { total: 1, items: [{ id: 2, replies: 0 }] } },
		{ descriptor: list("posts"), expected: { total: 1, items: [{ id: 3 }] } },
		{ descriptor: list("attachments"), expected: { total: 0, items: [] } },
		{
			descriptor: list("users"),
			expected: {
				items: expect.arrayContaining([
					expect.objectContaining({ id: 10, posts: 0, attachmentsCount: 0 }),
					expect.objectContaining({ id: 20, posts: 1, attachmentsCount: 0 }),
				]),
			},
		},
		{
			descriptor: list("forums", ""),
			expected: {
				items: expect.arrayContaining([
					expect.objectContaining({ id: 1, threads: 0, posts: 0 }),
					expect.objectContaining({ id: 2, threads: 1, posts: 1 }),
				]),
			},
		},
	];
	const snapshots = (await warmMany(targets.map((target) => target.descriptor))).map(
		(snapshot, index) => ({ ...targets[index], ...snapshot }),
	);
	expect(snapshots.every((snapshot) => snapshot.data !== null)).toBe(true);
	const other = await warm(unrelated);

	const response = await users.ban(
		createAdminRequest("POST", "/api/admin/users/10/ban", { deleteContent: true }),
		f.env,
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		data: {
			banned: true,
			contentDeleted: true,
			threadsDeleted: 1,
			postsDeleted: 3,
		},
	});
	expect(f.sqlite.prepare("SELECT id FROM threads").all()).toEqual([{ id: 2 }]);
	expect(f.sqlite.prepare("SELECT id FROM posts").all()).toEqual([{ id: 3 }]);
	expect(f.sqlite.prepare("SELECT id FROM attachments").all()).toEqual([]);
	await expectStillWarm(other);
	for (const snapshot of snapshots) {
		const data = await readAdminEntity(f.env, undefined, snapshot.descriptor);
		if (snapshot.expected === null) expect(data).toBeNull();
		else expect(data).toMatchObject(snapshot.expected);
		expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).not.toBe(snapshot.key);
	}
	const queries = f.calls.length;
	for (const snapshot of snapshots) await readAdminEntity(f.env, undefined, snapshot.descriptor);
	expect(f.calls).toHaveLength(queries);
});
