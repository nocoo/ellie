import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as forums from "../../../../src/handlers/admin/forum";
import * as threadTypes from "../../../../src/handlers/admin/forumThreadType";
import { adminEntityCacheKey, readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

function typesDescriptor(forumId: number): CacheDescriptor {
	return { family: "admin:thread-types", params: { forumId }, scope: "admin" };
}

function detail(entity: string, id: number): CacheDescriptor {
	return { family: "admin:entity:detail", params: { entity, id }, scope: "admin" };
}

function emptyTypes(forumId: number) {
	return {
		forumId,
		config: { enabled: false, required: false, listable: false, prefix: false },
		types: [],
	};
}

const unrelated = detail("censor_words", 1);
const actions = [
	{
		name: "remove",
		handler: forums.remove,
		method: "DELETE",
		path: "/api/admin/forums/1",
		body: undefined,
		forumId: 1,
		status: 200,
	},
	{
		name: "merge",
		handler: forums.merge,
		method: "POST",
		path: "/api/admin/forums/1/merge",
		body: { targetForumId: 2 },
		forumId: 1,
		status: 200,
	},
	{
		name: "create",
		handler: forums.create,
		method: "POST",
		path: "/api/admin/forums",
		body: { name: "Future forum" },
		forumId: 4,
		status: 201,
	},
] as const;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	// A failed merge must roll back its earlier statements, as D1 batch does.
	const batch = f.env.DB.batch.bind(f.env.DB);
	f.env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
		f.sqlite.exec("BEGIN");
		try {
			const results = await batch<T>(statements);
			f.sqlite.exec("COMMIT");
			return results;
		} catch (error) {
			f.sqlite.exec("ROLLBACK");
			throw error;
		}
	};
	f.sqlite.exec(`UPDATE forums SET thread_types_enabled = 1,
		thread_types_required = 1, thread_types_listable = 1 WHERE id = 2`);
	f.insert("forum_thread_types", {
		id: 101,
		forum_id: 2,
		source_typeid: 202,
		name: "Target category",
		display_order: 3,
		icon: "target.svg",
		enabled: 0,
		moderator_only: 1,
	});
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

async function expectListed(forumId: number, expected: unknown) {
	const response = await threadTypes.list(
		createAdminRequest("GET", `/api/admin/forums/${forumId}/thread-types`),
		f.env,
	);
	expect(response.status).toBe(expected === null ? 404 : 200);
	const body = await response.json();
	if (expected === null) expect(body.error.code).toBe("FORUM_NOT_FOUND");
	else expect(body.data).toEqual(expected);
}

async function warm(descriptor: CacheDescriptor) {
	const data = await readAdminEntity(f.env, undefined, descriptor);
	const key = await adminEntityCacheKey(f.env, descriptor);
	expect(f.values.has(key)).toBe(true);
	const snapshot = { descriptor, key, data };
	await expectStillWarm(snapshot);
	return snapshot;
}

async function expectStillWarm(snapshot: Awaited<ReturnType<typeof warm>>) {
	const queries = f.calls.length;
	expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).toBe(snapshot.key);
	expect(await readAdminEntity(f.env, undefined, snapshot.descriptor)).toEqual(snapshot.data);
	if (snapshot.descriptor.family === "admin:thread-types")
		await expectListed(Number(snapshot.descriptor.params.forumId), snapshot.data);
	expect(f.calls).toHaveLength(queries);
}

async function expectRefreshed(snapshot: Awaited<ReturnType<typeof warm>>, expected: unknown) {
	const queries = f.calls.length;
	const key = await adminEntityCacheKey(f.env, snapshot.descriptor);
	expect(f.calls).toHaveLength(queries);
	expect(key).not.toBe(snapshot.key);
	// The old snapshot still exists within its TTL; the new version must bypass it.
	expect(f.values.has(snapshot.key)).toBe(true);
	if (snapshot.descriptor.family === "admin:thread-types")
		await expectListed(Number(snapshot.descriptor.params.forumId), expected);
	else expect(await readAdminEntity(f.env, undefined, snapshot.descriptor)).toEqual(expected);
	expect(f.values.has(key)).toBe(true);
	await expectStillWarm({ descriptor: snapshot.descriptor, key, data: expected });
}

describe("forum existence changes invalidate Admin thread types", () => {
	it.each(actions)("$name replaces the warmed existence result within its TTL", async (action) => {
		const source = await warm(typesDescriptor(action.forumId));
		expect(source.data).toEqual(action.name === "create" ? null : emptyTypes(1));
		const target = await warm(typesDescriptor(2));
		expect(target.data).toEqual({
			forumId: 2,
			config: { enabled: true, required: true, listable: true, prefix: false },
			types: [
				{
					id: 101,
					forumId: 2,
					sourceTypeid: 202,
					name: "Target category",
					displayOrder: 3,
					icon: "target.svg",
					enabled: false,
					moderatorOnly: true,
				},
			],
		});
		const otherForum = await warm(detail("forums", 2));
		const other = await warm(unrelated);

		const response = await action.handler(
			createAdminRequest(action.method, action.path, action.body),
			f.env,
		);
		expect(response.status).toBe(action.status);
		const body = await response.json();
		if (action.name === "merge") {
			expect(body.data).toEqual({
				merged: true,
				sourceForumId: 1,
				targetForumId: 2,
				threadsMoved: 0,
				postsMoved: 0,
			});
		} else if (action.name === "create") {
			expect(body.data).toMatchObject({ id: 4, name: "Future forum" });
		} else {
			expect(body.data).toEqual({ deleted: true, id: 1 });
		}
		const row = f.sqlite.prepare("SELECT id FROM forums WHERE id = ?").get(action.forumId);
		expect(row).toEqual(action.name === "create" ? { id: 4 } : undefined);
		await expectRefreshed(source, action.name === "create" ? emptyTypes(4) : null);
		// These epochs cover a resource, so other forums reload the same data.
		await expectRefreshed(target, target.data);
		await expectRefreshed(otherForum, otherForum.data);
		await expectStillWarm(other);
	});

	it.each(actions)("failed $name leaves forum and type versions warm", async (action) => {
		const snapshots = [];
		for (const descriptor of [
			typesDescriptor(action.forumId),
			typesDescriptor(2),
			detail("forums", 2),
			unrelated,
		])
			snapshots.push(await warm(descriptor));
		const before = f.sqlite.prepare("SELECT * FROM forums ORDER BY id").all();
		f.sqlite.exec(`CREATE TRIGGER reject_forum_write
			BEFORE ${action.name === "create" ? "INSERT" : "DELETE"} ON forums
			BEGIN SELECT RAISE(ABORT, 'forced forum write failure'); END`);
		vi.mocked(f.env.KV.put).mockClear();

		await expect(
			action.handler(createAdminRequest(action.method, action.path, action.body), f.env),
		).rejects.toThrow("forced forum write failure");
		expect(f.sqlite.prepare("SELECT * FROM forums ORDER BY id").all()).toEqual(before);
		expect(f.env.KV.put).not.toHaveBeenCalled();
		for (const snapshot of snapshots) await expectStillWarm(snapshot);
	});
});

it("a zero-row deletion keeps the existing forum and thread types warm", async () => {
	const source = await warm(typesDescriptor(1));
	const forum = await warm(detail("forums", 1));
	const other = await warm(unrelated);
	f.sqlite.exec(`CREATE TRIGGER ignore_forum_delete BEFORE DELETE ON forums
		BEGIN SELECT RAISE(IGNORE); END`);
	vi.mocked(f.env.KV.put).mockClear();
	const response = await forums.remove(createAdminRequest("DELETE", "/api/admin/forums/1"), f.env);
	expect(response.status).toBe(200);
	expect((await response.json()).data).toEqual({ deleted: false, id: 1 });
	expect(f.sqlite.prepare("SELECT id FROM forums WHERE id = 1").get()).toEqual({ id: 1 });
	expect(f.env.KV.put).not.toHaveBeenCalled();
	for (const snapshot of [source, forum, other]) await expectStillWarm(snapshot);
});

it("an unchanged forum update keeps both resource versions warm", async () => {
	const source = await warm(typesDescriptor(1));
	const forum = await warm(detail("forums", 1));
	const other = await warm(unrelated);
	const queries = f.calls.length;
	vi.mocked(f.env.KV.put).mockClear();
	const response = await forums.update(
		createAdminRequest("PATCH", "/api/admin/forums/1", { name: "Public" }),
		f.env,
	);
	expect(response.status).toBe(200);
	expect(f.calls.slice(queries).some((call) => call.mode === "run")).toBe(false);
	expect(f.env.KV.put).not.toHaveBeenCalled();
	for (const snapshot of [source, forum, other]) await expectStillWarm(snapshot);
});

it("a forum rename refreshes forum data while its type snapshot stays warm", async () => {
	const source = await warm(typesDescriptor(1));
	const forum = await warm(detail("forums", 1));
	const other = await warm(unrelated);
	const response = await forums.update(
		createAdminRequest("PATCH", "/api/admin/forums/1", { name: "Renamed" }),
		f.env,
	);
	expect(response.status).toBe(200);
	await expectRefreshed(forum, { ...(forum.data as Record<string, unknown>), name: "Renamed" });
	await expectStillWarm(source);
	await expectStillWarm(other);
});

it("a rejected self-merge leaves the forum and thread types warm", async () => {
	const source = await warm(typesDescriptor(1));
	const forum = await warm(detail("forums", 1));
	vi.mocked(f.env.KV.put).mockClear();
	const response = await forums.merge(
		createAdminRequest("POST", "/api/admin/forums/1/merge", { targetForumId: 1 }),
		f.env,
	);
	expect(response.status).toBe(400);
	expect((await response.json()).error).toMatchObject({ code: "INVALID_BODY" });
	expect(f.env.KV.put).not.toHaveBeenCalled();
	await expectStillWarm(source);
	await expectStillWarm(forum);
});
