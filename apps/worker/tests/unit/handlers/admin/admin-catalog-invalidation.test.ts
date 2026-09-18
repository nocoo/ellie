import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as forumThreadType from "../../../../src/handlers/admin/forumThreadType";
import * as settings from "../../../../src/handlers/admin/settings";
import { adminEntityCacheKey, readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

const settingsDesc: CacheDescriptor = { family: "admin:settings", params: {}, scope: "admin" };
const typesDesc: CacheDescriptor = {
	family: "admin:thread-types",
	params: { forumId: 1 },
	scope: "admin",
};
const forumsDesc: CacheDescriptor = {
	family: "admin:entity:detail",
	params: { entity: "forums", id: 1 },
	scope: "admin",
};
const unrelated: CacheDescriptor = {
	family: "admin:entity:detail",
	params: { entity: "censor_words", id: 1 },
	scope: "admin",
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.insert("settings", {
		key: "general.site.name",
		value: "Old",
		type: "string",
		updated_at: 1,
	});
	f.insert("forum_thread_types", {
		id: 100,
		forum_id: 1,
		source_typeid: 100,
		name: "Question",
		display_order: 0,
		icon: "",
		enabled: 1,
		moderator_only: 0,
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

async function warm<T = unknown>(descriptor: CacheDescriptor) {
	const data = await readAdminEntity<T>(f.env, undefined, descriptor);
	const key = await adminEntityCacheKey(f.env, descriptor);
	expect(f.values.has(key)).toBe(true);
	const queries = f.calls.length;
	expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(data);
	expect(f.calls).toHaveLength(queries);
	return { descriptor, key, data };
}

async function expectStillWarm(snapshot: Awaited<ReturnType<typeof warm>>) {
	const queries = f.calls.length;
	expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).toBe(snapshot.key);
	expect(await readAdminEntity(f.env, undefined, snapshot.descriptor)).toEqual(snapshot.data);
	expect(f.calls).toHaveLength(queries);
}

async function expectRefreshed(snapshot: Awaited<ReturnType<typeof warm>>) {
	expect(await adminEntityCacheKey(f.env, snapshot.descriptor)).not.toBe(snapshot.key);
	await readAdminEntity(f.env, undefined, snapshot.descriptor);
}

describe("Admin catalog mutations publish resource epochs after confirmed changes", () => {
	it("settings bulkUpdate refreshes settings and leaves other resources warm", async () => {
		const catalog = await warm(settingsDesc);
		const types = await warm(typesDesc);
		const other = await warm(unrelated);
		const response = await settings.bulkUpdate(
			createAdminRequest("PUT", "/api/admin/settings", { "general.site.name": "Ellie" }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect(
			f.sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("general.site.name"),
		).toEqual({ value: "Ellie" });
		await expectRefreshed(catalog);
		const next = await readAdminEntity<Record<string, { value: string }>>(
			f.env,
			undefined,
			settingsDesc,
		);
		expect(next["general.site.name"]?.value).toBe("Ellie");
		await expectStillWarm(types);
		await expectStillWarm(other);
	});

	it("thread-type name update refreshes forum_thread_types only", async () => {
		const types = await warm(typesDesc);
		const catalog = await warm(settingsDesc);
		const forums = await warm(forumsDesc);
		const other = await warm(unrelated);
		const response = await forumThreadType.update(
			createAdminRequest("PATCH", "/api/admin/forum-thread-types/100", { name: "Answer" }),
			f.env,
		);
		expect(response.status).toBe(200);
		expect(f.sqlite.prepare("SELECT name FROM forum_thread_types WHERE id = 100").get()).toEqual({
			name: "Answer",
		});
		await expectRefreshed(types);
		const next = await readAdminEntity<{ types: { name: string }[] }>(f.env, undefined, typesDesc);
		expect(next?.types[0]?.name).toBe("Answer");
		await expectStillWarm(catalog);
		await expectStillWarm(forums);
		await expectStillWarm(other);
	});

	it("thread-type config update refreshes forum_thread_types and forums", async () => {
		const types = await warm(typesDesc);
		const forums = await warm(forumsDesc);
		const catalog = await warm(settingsDesc);
		const other = await warm(unrelated);
		const response = await forumThreadType.updateConfig(
			createAdminRequest("PATCH", "/api/admin/forums/1/thread-types-config", { enabled: true }),
			f.env,
		);
		expect(response.status).toBe(200);
		await expectRefreshed(types);
		await expectRefreshed(forums);
		await expectStillWarm(catalog);
		await expectStillWarm(other);
	});
});

describe("Admin catalog no-ops and failed writes keep warmed versions", () => {
	it("settings empty, invalid, and identical values do not bump settings", async () => {
		const catalog = await warm(settingsDesc);
		const other = await warm(unrelated);
		expect(
			(await settings.bulkUpdate(createAdminRequest("PUT", "/api/admin/settings", {}), f.env))
				.status,
		).toBe(400);
		expect(
			(
				await settings.bulkUpdate(
					createAdminRequest("PUT", "/api/admin/settings", { "not.a.key": "x" }),
					f.env,
				)
			).status,
		).toBe(400);
		expect(
			(
				await settings.bulkUpdate(
					createAdminRequest("PUT", "/api/admin/settings", { "general.site.name": "Old" }),
					f.env,
				)
			).status,
		).toBe(200);
		await expectStillWarm(catalog);
		await expectStillWarm(other);
	});

	it("settings unconfirmed upsert leaves warmed settings intact", async () => {
		const catalog = await warm(settingsDesc);
		const other = await warm(unrelated);
		vi.spyOn(f.env.DB, "batch").mockResolvedValue([
			{ success: false, results: [], meta: { changes: 1 } },
		] as unknown as D1Result[]);
		await expect(
			settings.bulkUpdate(
				createAdminRequest("PUT", "/api/admin/settings", { "general.site.name": "Ellie" }),
				f.env,
			),
		).rejects.toThrow("D1 batch writes were not confirmed");
		expect(
			f.sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("general.site.name"),
		).toEqual({ value: "Old" });
		await expectStillWarm(catalog);
		await expectStillWarm(other);
	});

	it("thread-type no-op and unconfirmed update leave warmed types intact", async () => {
		const types = await warm(typesDesc);
		const forums = await warm(forumsDesc);
		const other = await warm(unrelated);
		const noop = await forumThreadType.update(
			createAdminRequest("PATCH", "/api/admin/forum-thread-types/100", { name: "Question" }),
			f.env,
		);
		expect(noop.status).toBe(200);
		await expectStillWarm(types);
		const prepare = f.env.DB.prepare.bind(f.env.DB);
		vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
			const statement = prepare(sql);
			if (!/^\s*UPDATE forum_thread_types SET /.test(sql)) return statement;
			return {
				...statement,
				bind: (...args: Parameters<D1PreparedStatement["bind"]>) => {
					const bound = statement.bind(...args);
					return {
						...bound,
						run: async () => ({ success: false, results: [], meta: { changes: 1 } }),
					} as D1PreparedStatement;
				},
			};
		});
		await expect(
			forumThreadType.update(
				createAdminRequest("PATCH", "/api/admin/forum-thread-types/100", { name: "Answer" }),
				f.env,
			),
		).rejects.toThrow("D1 write was not confirmed");
		expect(f.sqlite.prepare("SELECT name FROM forum_thread_types WHERE id = 100").get()).toEqual({
			name: "Question",
		});
		await expectStillWarm(types);
		await expectStillWarm(forums);
		await expectStillWarm(other);
	});

	it("thread-type config no-op does not bump forums or types", async () => {
		const types = await warm(typesDesc);
		const forums = await warm(forumsDesc);
		const response = await forumThreadType.updateConfig(
			createAdminRequest("PATCH", "/api/admin/forums/1/thread-types-config", { enabled: false }),
			f.env,
		);
		expect(response.status).toBe(200);
		await expectStillWarm(types);
		await expectStillWarm(forums);
	});

	it("thread-type update with zero D1 changes after a stale snapshot keeps the hot key", async () => {
		const types = await warm(typesDesc);
		const other = await warm(unrelated);
		f.state.beforeWrite = async (sql) => {
			if (/^\s*UPDATE forum_thread_types SET /.test(sql)) {
				f.sqlite.prepare("DELETE FROM forum_thread_types WHERE id = 100").run();
			}
		};
		const response = await forumThreadType.update(
			createAdminRequest("PATCH", "/api/admin/forum-thread-types/100", { name: "Answer" }),
			f.env,
		);
		expect(response.status).toBe(200);
		await expectStillWarm(types);
		await expectStillWarm(other);
	});

	it("thread-type config with zero D1 changes after a stale snapshot keeps hot keys", async () => {
		const types = await warm(typesDesc);
		const forums = await warm(forumsDesc);
		f.state.beforeWrite = async (sql) => {
			if (/^\s*UPDATE forums SET /.test(sql)) {
				f.sqlite.prepare("DELETE FROM forums WHERE id = 1").run();
			}
		};
		const response = await forumThreadType.updateConfig(
			createAdminRequest("PATCH", "/api/admin/forums/1/thread-types-config", { enabled: true }),
			f.env,
		);
		expect(response.status).toBe(200);
		await expectStillWarm(types);
		await expectStillWarm(forums);
	});

	it("identical thread-type reorder skips the resource epoch", async () => {
		f.insert("forum_thread_types", {
			id: 101,
			forum_id: 1,
			source_typeid: 101,
			name: "Guide",
			display_order: 1,
			icon: "",
			enabled: 1,
			moderator_only: 0,
		});
		const types = await warm(typesDesc);
		const response = await forumThreadType.reorder(
			createAdminRequest("PATCH", "/api/admin/forums/1/thread-types/reorder", {
				ids: [100, 101],
			}),
			f.env,
		);
		expect(response.status).toBe(200);
		await expectStillWarm(types);
	});
});
