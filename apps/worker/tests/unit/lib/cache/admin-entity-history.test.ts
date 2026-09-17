import type { CacheDescriptor, Forum } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list as listForums } from "../../../../src/handlers/admin/forum";
import {
	adminEntityCacheKey,
	isAdminEntityCacheData,
	readAdminEntity,
	rebuildAdminEntityCache,
} from "../../../../src/lib/cache/admin-entity-read";
import { createCacheEnvelope } from "../../../../src/lib/cache/store";
import type { AdminEntityList } from "../../../../src/lib/crud";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

type ForumList = Omit<AdminEntityList, "items"> & { items: Forum[] };
let f: ReturnType<typeof readingFixture>;
const descriptor: CacheDescriptor = {
	family: "admin:entity:list",
	params: { entity: "forums", query: "" },
	scope: "admin",
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(1_700_000_000_000);
	f = readingFixture();
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	f.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

async function rebuildPlaceholder(forumId = 0): Promise<ForumList> {
	// migrateThreads creates these for missing forum IDs referenced by imported threads.
	f.insert("forums", {
		id: forumId,
		name: `[已删除版块${forumId}]`,
		status: -1,
		threads: 1,
		posts: 1,
		last_thread_id: 1,
		last_post_at: 1,
		last_poster: "bob",
		last_poster_id: 20,
		last_thread_subject: "Thread 1",
	});
	f.thread(1, { forum_id: forumId });
	f.post(1, { forum_id: forumId });
	return (await rebuildAdminEntityCache(f.env, f.ctx, descriptor)) as ForumList;
}

describe("Admin forum DTOs preserve historical import records", () => {
	it.each([0, 404])("lists a deleted-forum placeholder with id=%s", async (forumId) => {
		const authoritative = await rebuildPlaceholder(forumId);
		const expected = {
			id: forumId,
			parentId: 0,
			name: `[已删除版块${forumId}]`,
			description: "",
			announcement: "",
			icon: "",
			displayOrder: 0,
			threads: 1,
			posts: 1,
			type: "forum",
			status: -1,
			visibility: "public",
			moderators: "",
			moderatorList: [],
			todayThreads: 0,
			lastThreadId: 1,
			lastPostAt: 1,
			lastPoster: "bob",
			lastPosterId: 20,
			lastPosterAvatar: "",
			lastPosterAvatarPath: "",
			lastThreadSubject: "Thread 1",
			threadTypes: { enabled: false, required: false, listable: false, prefix: false },
		};
		expect(authoritative.items.find((row) => row.id === forumId)).toEqual(expected);
		expect(authoritative).toMatchObject({ total: 4, page: 1, limit: 20, paginated: false });
		expect(f.calls).toHaveLength(1);
		expect(f.calls.every((call) => /^\s*SELECT\b/i.test(call.sql))).toBe(true);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.env.KV.delete).not.toHaveBeenCalled();
		expect(f.ctx.waitUntil).not.toHaveBeenCalled();

		const queries = f.calls.length;
		const key = await adminEntityCacheKey(f.env, descriptor);
		expect(f.calls).toHaveLength(queries);
		const response = await listForums(
			createAdminRequest("GET", "/api/admin/forums?limit=20&page=1"),
			f.env,
		);
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual(authoritative.items);
		expect(isAdminEntityCacheData(descriptor, authoritative)).toBe(true);
		const cached = f.values.get(key);
		const envelope = JSON.parse(cached ?? "null");
		expect(envelope).toMatchObject({
			...descriptor,
			tier: "SHORT",
			data: authoritative,
		});
		expect(envelope.expiresAt - envelope.loadedAt).toBe(60_000);

		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(authoritative);
		const hotResponse = await listForums(createAdminRequest("GET", "/api/admin/forums"), f.env);
		expect(hotResponse.status).toBe(200);
		expect((await hotResponse.json()).data).toEqual(authoritative.items);
		expect(f.calls).toHaveLength(0);

		// Management rebuild must read current SQL without touching the warm snapshot.
		f.sqlite.prepare("UPDATE forums SET name = ? WHERE id = ?").run("Renamed", forumId);
		vi.clearAllMocks();
		const fresh = (await rebuildAdminEntityCache(f.env, f.ctx, descriptor)) as ForumList;
		expect(fresh.items.find((row) => row.id === forumId)).toEqual({ ...expected, name: "Renamed" });
		expect(isAdminEntityCacheData(descriptor, fresh)).toBe(true);
		expect(f.calls).toHaveLength(1);
		expect(f.values.get(key)).toBe(cached);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.env.KV.delete).not.toHaveBeenCalled();
		expect(f.ctx.waitUntil).not.toHaveBeenCalled();
	});

	const corruptions: [string, Record<string, unknown>][] = [
		["negative ID", { id: -1 }],
		["fractional ID", { id: 0.5 }],
		["unsafe ID", { id: Number.MAX_SAFE_INTEGER + 1 }],
		["string ID", { id: "0" }],
		["null ID", { id: null }],
		["boolean ID", { id: false }],
		["object ID", { id: { value: 0 } }],
		["NaN ID", { id: Number.NaN }],
		["infinite ID", { id: Number.POSITIVE_INFINITY }],
		["duplicate ID", { id: 1 }],
		["additional field", { password_hash: "FAKE_PRIVATE_MARKER" }],
		["missing name", { name: undefined }],
		["string counter", { threads: "1" }],
		["object in nullable number", { lastThreadId: { secret: "extra" } }],
		[
			"nonboolean type switch",
			{ threadTypes: { enabled: 1, required: false, listable: false, prefix: false } },
		],
		["zero moderator ID", { moderatorList: [{ id: 0, name: "forged" }] }],
	];
	it.each(corruptions)("rejects a cached historical forum with %s", async (_label, patch) => {
		const good = await rebuildPlaceholder();
		const corrupt = {
			...good,
			items: good.items.map((row) => (row.id === 0 ? { ...row, ...patch } : row)),
		};
		expect(isAdminEntityCacheData(descriptor, good)).toBe(true);
		expect(isAdminEntityCacheData(descriptor, corrupt)).toBe(false);
		const key = await adminEntityCacheKey(f.env, descriptor);
		f.values.set(
			key,
			JSON.stringify(createCacheEnvelope(corrupt, { ...descriptor, tier: "SHORT" })),
		);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
		expect(f.calls).toHaveLength(1);
		expect(JSON.parse(f.values.get(key) ?? "null").data).toEqual(good);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
		expect(f.calls).toHaveLength(0);
	});

	const invalidDescriptors: CacheDescriptor[] = [
		{ family: "admin:entity:detail", scope: "admin", params: { entity: "forums", id: 0 } },
		{ family: "admin:thread-types", scope: "admin", params: { forumId: 0 } },
		{ ...descriptor, scope: "public" },
	];
	it.each(invalidDescriptors)("retains the existing descriptor gate: %j", async (invalid) => {
		await expect(adminEntityCacheKey(f.env, invalid)).rejects.toThrow();
		await expect(rebuildAdminEntityCache(f.env, f.ctx, invalid)).rejects.toThrow();
		await expect(readAdminEntity(f.env, undefined, invalid)).rejects.toThrow();
		expect(isAdminEntityCacheData(invalid, null)).toBe(false);
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});

	it("retains positive IDs for non-forum entities", async () => {
		const users: CacheDescriptor = {
			...descriptor,
			params: { entity: "users", query: "limit=20&page=1" },
		};
		const good = (await rebuildAdminEntityCache(f.env, undefined, users)) as AdminEntityList;
		const items = good.items as Record<string, unknown>[];
		expect(items).toHaveLength(5);
		expect(isAdminEntityCacheData(users, good)).toBe(true);
		expect(
			isAdminEntityCacheData(users, {
				...good,
				items: items.map((row, index) => (index === 0 ? { ...row, id: 0 } : row)),
			}),
		).toBe(false);
	});
});
