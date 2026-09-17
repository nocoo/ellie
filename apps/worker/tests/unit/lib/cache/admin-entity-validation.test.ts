import { type CacheDescriptor, EMPTY_RATING_AGGREGATE, type User } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	adminEntityCacheKey,
	getAdminEntities,
	isAdminEntityCacheData,
	readAdminEntity,
	rebuildAdminEntityCache,
} from "../../../../src/lib/cache/admin-entity-read";
import { createCacheEnvelope } from "../../../../src/lib/cache/store";
import type { AdminEntityList } from "../../../../src/lib/crud";
import { toUser } from "../../../../src/lib/mappers";
import type { SettingsDetailMap } from "../../../../src/lib/settings";
import { readingFixture } from "./thread-cache-fixture";

type Row = Record<string, unknown>;
type ListData = AdminEntityList & { items: Row[] };
type ThreadTypes = { forumId: number; config: Row; types: Row[] };
let f: ReturnType<typeof readingFixture>;

const detail = (entity = "users", id = 10): CacheDescriptor => ({
	family: "admin:entity:detail",
	scope: "admin",
	params: { entity, id },
});
const list = (
	entity = "users",
	query = entity === "forums" ? "" : "limit=20&page=1",
): CacheDescriptor => ({
	family: "admin:entity:list",
	scope: "admin",
	params: { entity, query },
});
const settings: CacheDescriptor = { family: "admin:settings", scope: "admin", params: {} };
const staff: CacheDescriptor = { family: "admin:users:staff", scope: "admin", params: {} };
const threadTypes: CacheDescriptor = {
	family: "admin:thread-types",
	scope: "admin",
	params: { forumId: 1 },
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(1_700_000_000_000);
	f = readingFixture();
	f.thread(1);
	f.post(1);
	f.post(2);
	f.insert("attachments", {
		id: 1,
		thread_id: 1,
		post_id: 1,
		author_id: 10,
		filename: "a.png",
		file_path: "forum/a.png",
	});
	f.insert("censor_words", { id: 1, find: "word", admin_id: 1, created_at: 1 });
	f.insert("ip_bans", { id: 1, ip: "192.0.2.1", admin_id: 1, created_at: 1 });
	f.insert("admin_logs", {
		id: 1,
		admin_id: 1,
		action: "thread.update",
		created_at: 1,
		details: '{"fields":["subject"]}',
	});
	f.insert("announcements", { id: 1, title: "News", author_id: 1, created_at: 1 });
	f.insert("forum_thread_types", { id: 1, forum_id: 1, source_typeid: 1, name: "Discussion" });
	f.insert("forum_thread_types", { id: 2, forum_id: 2, source_typeid: 1, name: "Staff" });
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function poison(descriptor: CacheDescriptor, data: unknown) {
	const key = await adminEntityCacheKey(f.env, descriptor);
	f.values.set(key, JSON.stringify(createCacheEnvelope(data, { ...descriptor, tier: "SHORT" })));
	return key;
}

async function expectReload(descriptor: CacheDescriptor, good: unknown, corrupt: unknown) {
	expect(isAdminEntityCacheData(descriptor, corrupt)).toBe(false);
	const key = await poison(descriptor, corrupt);
	f.calls.length = 0;
	expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
	expect(f.calls.length).toBeGreaterThan(0);
	expect(JSON.parse(f.values.get(key) ?? "null").data).toEqual(good);
	const originCalls = f.calls.length;
	expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
	expect(f.calls).toHaveLength(originCalls);
}

describe("Admin DTO projections from real SQL", () => {
	it.each([
		["users", 10],
		["forums", 1],
		["threads", 1],
		["posts", 1],
		["attachments", 1],
		["censor_words", 1],
		["ip_bans", 1],
		["admin_logs", 1],
		["announcements", 1],
	] as const)(
		"accepts complete %s detail/list projections and serves them hot without D1",
		async (entity, id) => {
			for (const descriptor of [detail(entity, id), list(entity)]) {
				f.calls.length = 0;
				await adminEntityCacheKey(f.env, descriptor);
				expect(f.calls).toHaveLength(0);
				const cold = await readAdminEntity(f.env, undefined, descriptor);
				expect(isAdminEntityCacheData(descriptor, cold)).toBe(true);
				expect(f.calls.length).toBeGreaterThan(0);
				f.calls.length = 0;
				expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(cold);
				expect(f.calls).toHaveLength(0);
			}
		},
	);

	it("keeps the post rating aggregate DTO on every list row, including the second row", async () => {
		const descriptor = list("posts", "limit=20&page=1&sort=position_asc&threadId=1");
		const data = await readAdminEntity<ListData>(f.env, undefined, descriptor);
		expect(data.items.map((row) => row.id)).toEqual([1, 2]);
		expect(data.items.map((row) => row.ratingAggregate)).toEqual([
			EMPTY_RATING_AGGREGATE,
			EMPTY_RATING_AGGREGATE,
		]);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(data);
		expect(f.calls).toHaveLength(0);
	});

	it("preserves nullable latest-content joins and nullable scheduling fields", async () => {
		f.thread(2, { forum_id: 3 });
		for (const [descriptor, nullableFields] of [
			[detail("threads", 2), ["lastPostAt", "lastPoster"]],
			[detail("forums", 2), ["lastThreadId", "lastPostAt", "lastPoster", "lastThreadSubject"]],
			[detail("ip_bans", 1), ["expiresAt"]],
			[detail("admin_logs", 1), ["targetId"]],
			[detail("announcements", 1), ["startAt", "endAt"]],
		] as const) {
			const row = await readAdminEntity<Row>(f.env, undefined, descriptor);
			for (const field of nullableFields) expect(row[field]).toBeNull();
			expect(isAdminEntityCacheData(descriptor, row)).toBe(true);
			f.calls.length = 0;
			expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(row);
			expect(f.calls).toHaveLength(0);
		}
	});

	it("validates a cached staff collection before the users handler needs to register", async () => {
		const rows = f.sqlite
			.prepare("SELECT * FROM users WHERE role > 0 ORDER BY role, username")
			.all()
			.map((row) => toUser(row as Row));
		await poison(staff, rows);
		expect(await readAdminEntity(f.env, undefined, staff)).toEqual(rows);
		expect(f.calls).toHaveLength(0);
	});

	it("retains the 60-second Admin snapshot boundary after a direct SQL update", async () => {
		const descriptor = detail();
		const cold = await readAdminEntity<User>(f.env, undefined, descriptor);
		f.sqlite.prepare("UPDATE users SET username = ? WHERE id = ?").run("alice-new", 10);
		f.calls.length = 0;
		vi.setSystemTime(1_700_000_059_999);
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(cold);
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(1_700_000_060_000);
		const fresh = await readAdminEntity<User>(f.env, undefined, descriptor);
		expect(fresh.username).toBe("alice-new");
		expect(f.calls).toHaveLength(1);
	});
});

describe("Admin cache corruption cannot widen DTO fields or scopes", () => {
	const corruptions: [string, (row: Row) => unknown][] = [
		["nested role object", (row) => ({ ...row, role: { password_hash: "FAKE_PRIVATE_MARKER" } })],
		["array username", (row) => ({ ...row, username: ["alice"] })],
		["non-finite number", (row) => ({ ...row, credits: Number.NaN })],
		[
			"missing projected field",
			(row) => {
				delete row.email;
				return row;
			},
		],
		["undeclared credential field", (row) => ({ ...row, passwordHash: "FAKE_PRIVATE_MARKER" })],
		[
			"cached online overlay",
			(row) => ({ ...row, onlineIp: "192.0.2.2", onlinePage: "/", onlineTs: 1 }),
		],
		[
			"list enrichment on a detail row",
			(row) => ({ ...row, messagesCount: 5, attachmentsCount: 2 }),
		],
		["another resource ID", (row) => ({ ...row, id: 20 })],
		[
			"wider checkin level",
			(row) => ({
				...row,
				checkin: {
					totalDays: 1,
					monthDays: 1,
					streakDays: 1,
					lastCheckinAt: 1,
					level: { minDays: 1, level: 1, label: "L1", passwordHash: "FAKE_PRIVATE_MARKER" },
				},
			}),
		],
	];
	it.each(corruptions)("reloads a complete user instead of exposing %s", async (_label, mutate) => {
		const descriptor = detail();
		const good = (await rebuildAdminEntityCache(f.env, undefined, descriptor)) as Row;
		await expectReload(descriptor, good, mutate(structuredClone(good)));
	});

	it("bulk detail reads reload only the corrupted key and reuse unaffected users", async () => {
		const warm = await getAdminEntities<User>(f.env, undefined, "users", [10, 20]);
		const user = warm.get(10);
		expect(user).toBeDefined();
		await poison(detail(), { ...user, role: { password_hash: "FAKE_PRIVATE_MARKER" } });
		f.calls.length = 0;
		const batch = await getAdminEntities<User>(f.env, undefined, "users", [10, 20]);
		expect(batch).toEqual(warm);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toContain("FROM users WHERE id IN");
		expect(f.calls[0].params).toEqual([10]);
	});

	it("requires staff rows to satisfy the staff membership predicate", async () => {
		const good = await rebuildAdminEntityCache(f.env, undefined, staff);
		const ordinaryUser = await rebuildAdminEntityCache(f.env, undefined, detail());
		await expectReload(staff, good, [ordinaryUser]);
	});

	it.each([
		[
			"forums",
			{
				threadTypes: {
					enabled: true,
					required: false,
					listable: false,
					prefix: false,
					secret: "extra",
				},
			},
		],
		["forums", { moderatorList: [{ id: 30, name: "mod", email: "private@example.test" }] }],
		["threads", { subject: { raw: "text", secret: "extra" } }],
		["posts", { ratingAggregate: 0 }],
		[
			"posts",
			{
				ratingAggregate: {
					total: 1,
					credits: { count: 1, sum: 1, raterEmail: "private@example.test" },
					coins: { count: 0, sum: 0 },
				},
			},
		],
		["attachments", { filePath: { secret: "extra" } }],
		["ip_bans", { expiresAt: "never" }],
		["censor_words", { replacement: { secret: "extra" } }],
		["admin_logs", { details: { secret: "extra" } }],
		["announcements", { forumIds: [1, 2] }],
	] as const)("reloads malformed %s projections", async (entity, patch) => {
		const descriptor = detail(entity, 1);
		const good = (await rebuildAdminEntityCache(f.env, undefined, descriptor)) as Row;
		await expectReload(descriptor, good, { ...good, ...patch });
	});
});

describe("Admin pagination is bound to the descriptor and registered config", () => {
	const corruptions: [string, (row: ListData) => unknown][] = [
		["paginated=false", (row) => ({ ...row, paginated: false })],
		["wrong page", (row) => ({ ...row, page: 1 })],
		["wrong limit", (row) => ({ ...row, limit: 100 })],
		["noninteger total", (row) => ({ ...row, total: 2.5 })],
		["negative total", (row) => ({ ...row, total: -1 })],
		["extra collection field", (row) => ({ ...row, passwordHash: "extra" })],
		[
			"rows beyond requested limit",
			(row) => ({ ...row, items: [row.items[0], { ...row.items[0], id: 99 }] }),
		],
	];
	it.each(corruptions)("rejects %s on a canonical paginated user list", async (_label, mutate) => {
		const descriptor = list("users", "limit=1&page=2");
		const good = (await rebuildAdminEntityCache(f.env, undefined, descriptor)) as ListData;
		expect(good.items).toHaveLength(1);
		await expectReload(descriptor, good, mutate(structuredClone(good)));
	});

	it("rejects the original 101-row paginated=false bypass under a page-2 key", async () => {
		const descriptor = list("users", "limit=20&page=2");
		const good = (await rebuildAdminEntityCache(f.env, undefined, descriptor)) as ListData;
		const first = (await rebuildAdminEntityCache(f.env, undefined, list())) as ListData;
		await expectReload(descriptor, good, {
			items: Array.from({ length: 101 }, (_, index) => ({ ...first.items[0], id: index + 100 })),
			paginated: false,
			total: 101,
			page: 1,
			limit: 101,
		});
	});

	it("rejects duplicate membership even when all rows fit the requested limit", async () => {
		const descriptor = list();
		const good = (await rebuildAdminEntityCache(f.env, undefined, descriptor)) as ListData;
		await expectReload(descriptor, good, { ...good, items: [good.items[0], good.items[0]] });
	});

	it("preserves the legitimate unpaginated forum collection beyond 100 rows", async () => {
		for (let id = 100; id <= 200; id++) f.insert("forums", { id, name: `Forum ${id}` });
		const descriptor = list("forums");
		const good = await readAdminEntity<ListData>(f.env, undefined, descriptor);
		expect(good.items).toHaveLength(104);
		expect(good).toMatchObject({ paginated: false, total: 104, page: 1, limit: 20 });
		expect(isAdminEntityCacheData(descriptor, good)).toBe(true);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
		expect(f.calls).toHaveLength(0);
		await expectReload(descriptor, good, { ...good, page: 2 });
		await expectReload(descriptor, good, { ...good, limit: 104 });
		await expectReload(descriptor, good, { ...good, total: 1 });
	});

	it.each([
		["limit=1&page=2&sort=position_asc&threadId=1", [2]],
		["isFirst=1&limit=100&page=1&sort=position_asc&threadId=1", [1]],
		["limit=100&page=1000000&sort=position_asc&threadId=1", []],
	] as const)("caches legal sorted, filtered and deep pages: %s", async (query, ids) => {
		const descriptor = list("posts", query);
		const good = await readAdminEntity<ListData>(f.env, undefined, descriptor);
		expect(good.items.map((row) => row.id)).toEqual(ids);
		expect(isAdminEntityCacheData(descriptor, good)).toBe(true);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(good);
		expect(f.calls).toHaveLength(0);
	});
});

describe("Custom Admin collections have exact entry shapes", () => {
	it("keeps legitimate raw JSON, scalar settings and legacy keys unchanged", async () => {
		const rawValues = [
			[
				"json-object",
				"json",
				'{"nested":[null,true,{"label":"nav","password_hash":"literal configuration text"}]}',
			],
			["json-array", "json", '[{"label":"Forum","url":"/forum"}]'],
			["json-null", "json", "null"],
			["json-scalar", "json", "42"],
			["repairable-json", "json", "{legacy malformed JSON"],
			["number", "number", "12"],
			["boolean", "boolean", "true"],
		];
		for (const [key, type, value] of rawValues) {
			f.insert("settings", { key: `legacy.${key}`, type, value, updated_at: 123 });
		}
		const data = await readAdminEntity<SettingsDetailMap>(f.env, undefined, settings);
		for (const [key, type, value] of rawValues) {
			expect(data[`legacy.${key}`]).toEqual({ value, type, updatedAt: 123 });
		}
		expect(isAdminEntityCacheData(settings, data)).toBe(true);
		f.calls.length = 0;
		expect(await readAdminEntity(f.env, undefined, settings)).toEqual(data);
		expect(f.calls).toHaveLength(0);
	});

	it.each([
		{ value: { nested: "wrong wire type" }, type: "json", updatedAt: 1 },
		{ value: "[]", type: "array", updatedAt: 1 },
		{ value: "[]", type: "json", updatedAt: "1" },
		{ value: "[]", type: "json", updatedAt: 1, secret: "extra" },
		{ value: "[]", type: "json" },
		[],
	])("rejects malformed SettingEntry metadata: %j", async (entry) => {
		const good = (await rebuildAdminEntityCache(f.env, undefined, settings)) as Row;
		await expectReload(settings, good, { ...good, "forged.entry": entry });
	});

	const typeCorruptions: [string, (row: ThreadTypes) => unknown][] = [
		["another forum in the collection", (row) => ({ ...row, forumId: 2 })],
		[
			"another forum on a type row",
			(row) => ({ ...row, types: [{ ...row.types[0], forumId: 2 }] }),
		],
		["additional collection field", (row) => ({ ...row, secret: "extra" })],
		["additional config field", (row) => ({ ...row, config: { ...row.config, secret: "extra" } })],
		["nonboolean config switch", (row) => ({ ...row, config: { ...row.config, enabled: 1 } })],
		[
			"additional type field",
			(row) => ({ ...row, types: [{ ...row.types[0], email: "private@example.test" }] }),
		],
		[
			"missing type field",
			(row) => {
				delete row.types[0].icon;
				return row;
			},
		],
		[
			"nested source ID",
			(row) => ({ ...row, types: [{ ...row.types[0], sourceTypeid: { secret: "extra" } }] }),
		],
		["duplicate type ID", (row) => ({ ...row, types: [row.types[0], row.types[0]] })],
	];
	it.each(typeCorruptions)("rejects %s", async (_label, mutate) => {
		const good = (await rebuildAdminEntityCache(f.env, undefined, threadTypes)) as ThreadTypes;
		expect(isAdminEntityCacheData(threadTypes, good)).toBe(true);
		await expectReload(threadTypes, good, mutate(structuredClone(good)));
	});

	it.each([settings, staff, threadTypes])(
		"pure rebuild for $family reads only authoritative data",
		async (descriptor) => {
			const data = await rebuildAdminEntityCache(f.env, f.ctx, descriptor);
			expect(isAdminEntityCacheData(descriptor, data)).toBe(true);
			expect(f.calls.length).toBeGreaterThan(0);
			expect(f.calls.every((call) => /^\s*SELECT\b/i.test(call.sql))).toBe(true);
			expect(f.env.KV.get).not.toHaveBeenCalled();
			expect(f.env.KV.put).not.toHaveBeenCalled();
			expect(f.env.KV.delete).not.toHaveBeenCalled();
			expect(f.ctx.waitUntil).not.toHaveBeenCalled();
		},
	);

	it.each([settings, staff, threadTypes])(
		"$family does not cache a failed D1 read as an empty collection",
		async (descriptor) => {
			const key = await adminEntityCacheKey(f.env, descriptor);
			f.state.queryError = true;
			await expect(readAdminEntity(f.env, undefined, descriptor)).rejects.toThrow();
			expect(f.values.has(key)).toBe(false);
			f.state.queryError = false;
			const data = await readAdminEntity(f.env, undefined, descriptor);
			expect(isAdminEntityCacheData(descriptor, data)).toBe(true);
			expect(f.values.has(key)).toBe(true);
		},
	);
});

describe("Admin descriptors remain exact and key checks stay D1-free", () => {
	const invalidDescriptors: CacheDescriptor[] = [
		{ ...detail(), scope: "public" },
		{ ...detail(), params: { entity: "users", id: 10, actorId: 1 } },
		{ ...detail(), params: { entity: "users", id: "10" } },
		{ ...detail(), params: { entity: "users", id: 0 } },
		{ ...detail(), params: { entity: "unknown", id: 10 } },
		{ ...detail(), family: "admin:unknown" },
		{ ...settings, params: { prefix: "general." } },
		{ ...staff, params: { role: 1 } },
		{ ...threadTypes, params: { forumId: "1" } },
		{ ...threadTypes, params: { forumId: 1, includeDeleted: true } },
		list("users", "page=1&limit=20"),
		list("users", "limit=101&page=1"),
		list("users", "limit=20&page=01"),
		list("users", "limit=20&page=1&sort=unknown"),
		list("users", "limit=20&page=1&unexpected=1"),
		list("forums", "limit=20&page=1"),
	];
	it.each(invalidDescriptors)("rejects invalid family/params/scope: %j", async (descriptor) => {
		await expect(adminEntityCacheKey(f.env, descriptor)).rejects.toThrow();
		await expect(rebuildAdminEntityCache(f.env, undefined, descriptor)).rejects.toThrow();
		expect(isAdminEntityCacheData(descriptor, null)).toBe(false);
		expect(isAdminEntityCacheData(descriptor, {})).toBe(false);
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});

	it("supports valid long filters without KV while retaining normalized descriptors and scope", async () => {
		const username = `long-${"x".repeat(4100)}`;
		f.insert("users", { id: 40, username });
		const descriptor = list("users", `limit=20&page=1&username=${username}`);
		await expect(adminEntityCacheKey(f.env, descriptor)).rejects.toThrow(
			"Invalid admin list parameters",
		);
		await expect(rebuildAdminEntityCache(f.env, undefined, descriptor)).rejects.toThrow(
			"Invalid admin list parameters",
		);
		const data = await readAdminEntity<ListData>(f.env, undefined, descriptor);
		expect(data.items.map((row) => row.id)).toEqual([40]);
		expect(isAdminEntityCacheData(descriptor, data)).toBe(false);
		await expect(
			readAdminEntity(f.env, undefined, descriptor, async () => ({
				...data,
				items: [{ ...data.items[0], role: { password_hash: "FAKE_PRIVATE_MARKER" } }],
			})),
		).rejects.toThrow("Cache loader returned an invalid value");
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		f.calls.length = 0;
		await expect(
			readAdminEntity(f.env, undefined, { ...descriptor, scope: "public" }),
		).rejects.toThrow("Admin scope is required");
		await expect(
			readAdminEntity(f.env, undefined, list("users", `username=${username}&page=1&limit=20`)),
		).rejects.toThrow("Invalid admin list parameters");
		expect(f.calls).toHaveLength(0);
	});
});
