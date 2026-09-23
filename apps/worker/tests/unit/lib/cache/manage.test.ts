import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bumpThreadMetaGen } from "../../../../src/lib/cache/invalidate";
import { KV_REGISTRY } from "../../../../src/lib/cache/kv-registry";
import {
	canRebuildCacheFamily,
	deleteCacheEntry,
	inspectCacheEntry,
	rebuildCacheEntry,
} from "../../../../src/lib/cache/manage";
import {
	getThreadRows,
	readingCacheKey,
	rebuildThreadCache,
} from "../../../../src/lib/cache/thread-loaders";
import { getPublicUsers, userCacheKey } from "../../../../src/lib/cache/user-read";
import {
	cacheGetOrSet,
	createCacheEnvelope,
	putCacheEnvelope,
} from "../../../../src/lib/cache/wrap";
import { getSettings } from "../../../../src/lib/settings";
import { getUserProfiles } from "../../../../src/lib/user-cache";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
const descriptor: CacheDescriptor = {
	family: "thread:entity",
	params: { threadId: 1 },
	scope: "internal",
};
const options = { ...descriptor, tier: "MEDIUM" as const };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function seed() {
	await getThreadRows(f.env, undefined, [1]);
	return readingCacheKey(f.env, descriptor);
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(Date.UTC(2026, 8, 17));

	f = readingFixture();
	f.thread(1);
	f.post(1);
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("cache management uses the original descriptor and authoritative loaders", () => {
	it("all shipped business families have a rebuild contract; runtime state does not", () => {
		for (const spec of KV_REGISTRY) {
			if (spec.status === "shipped" && spec.tier)
				expect(canRebuildCacheFamily(spec.family), spec.family).toBe(true);
		}
		expect(canRebuildCacheFamily("session")).toBe(false);
		expect(canRebuildCacheFamily("unknown")).toBe(false);
	});
	it("inspection is KV-only with actual bytes and unchanged deadlines", async () => {
		const key = await seed();
		const saved = f.values.get(key) ?? expect.fail("Missing cache snapshot");
		f.calls.length = 0;
		vi.mocked(f.env.KV.put).mockClear();
		vi.setSystemTime(Date.now() + 17_000);
		const observed = await inspectCacheEntry(f.env, key);
		expect(observed).toMatchObject({
			key,
			found: true,
			valid: true,
			staleVersion: false,
			currentVersion: key,
			sizeBytes: new TextEncoder().encode(saved).length,
		});
		expect(observed.envelope?.data).toMatchObject({ subject: "Thread 1" });
		expect(f.values.get(key)).toBe(saved);
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});
	it("expiry and schema/corruption are diagnostic; inspection never fills", async () => {
		const key = await seed();
		const entry = JSON.parse(f.values.get(key) ?? expect.fail("Missing cache snapshot"));
		f.calls.length = 0;
		vi.mocked(f.env.KV.put).mockClear();
		vi.setSystemTime(entry.expiresAt);
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({
			found: true,
			valid: false,
			staleVersion: false,
		});
		for (const raw of ["broken {", JSON.stringify({ ...entry, schemaVersion: 2 }), "{}", "null"]) {
			f.values.set(key, raw);
			expect(await inspectCacheEntry(f.env, key)).toMatchObject({
				found: true,
				valid: false,
				envelope: null,
			});
		}
		f.values.delete(key);
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({
			found: false,
			valid: false,
			sizeBytes: 0,
		});
		await expect(rebuildCacheEntry(f.env, undefined, key)).rejects.toMatchObject({
			stage: "validate",
			code: "INVALID_DESCRIPTOR",
		});
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});
	it("stale generations cannot be rebuilt or reported as current", async () => {
		const key = await seed();
		await bumpThreadMetaGen(f.env, 1);
		f.calls.length = 0;
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({ valid: false, staleVersion: true });
		await expect(rebuildCacheEntry(f.env, undefined, key)).rejects.toMatchObject({
			code: "STALE_VERSION",
			stage: "validate",
		});
		expect(f.calls).toHaveLength(0);
	});
	it("rebuild writes real changed content at MEDIUM with no views or metadata copied from the admin", async () => {
		const key = await seed();
		f.sqlite.exec("UPDATE threads SET subject = 'Updated', views = 19 WHERE id = 1");
		vi.setSystemTime(Date.now() + 10_000);
		f.calls.length = 0;
		const next = await rebuildCacheEntry(f.env, undefined, key);
		expect(next).toMatchObject({
			family: descriptor.family,
			scope: "internal",
			params: { threadId: 1 },
			tier: "MEDIUM",
			loadedAt: Date.now(),
			expiresAt: Date.now() + 1_800_000,
			data: { subject: "Updated" },
		});
		expect(JSON.parse(f.values.get(key) ?? expect.fail("Missing cache snapshot"))).toEqual(next);
		expect(f.calls).toHaveLength(1);
		expect(f.calls.every((call) => call.mode === "all" && /^SELECT/.test(call.sql))).toBe(true);
		expect(f.sqlite.prepare("SELECT views FROM threads WHERE id = 1").get()).toMatchObject({
			views: 19,
		});
	});
	it("authoritative absence replaces a previous body with a scoped SHORT negative", async () => {
		const key = await seed();
		f.sqlite.exec("DELETE FROM posts; DELETE FROM threads");
		const next = await rebuildCacheEntry(f.env, undefined, key);
		expect(next).toMatchObject({
			scope: "internal",
			params: { threadId: 1 },
			data: null,
			tier: "SHORT",
			expiresAt: Date.now() + 60_000,
		});
	});
	it.each(["read", "load", "write"] as const)(
		"a %s failure preserves the previous value and reports its real stage",
		async (stage) => {
			const key = await seed();
			const original = f.values.get(key);
			f.state.readError = stage === "read";
			f.state.queryError = stage === "load";
			f.state.writeError = stage === "write";
			await expect(rebuildCacheEntry(f.env, undefined, key)).rejects.toMatchObject({ stage });
			expect(f.values.get(key)).toBe(original);
			expect(f.env.KV.delete).not.toHaveBeenCalled();
		},
	);
	it("an epoch read failure is an error, not a missing/zero generation", async () => {
		const key = await seed();
		const get = vi.mocked(f.env.KV.get).getMockImplementation() ?? expect.fail("Missing KV mock");
		vi.mocked(f.env.KV.get).mockImplementation(async (name, ...args) => {
			if (typeof name === "string" && name !== key) throw new Error("KV 429");
			return get(name as string, ...(args as []));
		});
		await expect(inspectCacheEntry(f.env, key)).rejects.toMatchObject({
			code: "VERSION_READ_FAILED",
			stage: "read",
		});
	});
	it("a malformed original scope or row association cannot reach the loader", async () => {
		const key = await seed();
		const entry = JSON.parse(f.values.get(key) ?? expect.fail("Missing cache snapshot"));
		f.values.set(key, JSON.stringify({ ...entry, scope: "user:1" }));
		f.calls.length = 0;
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({
			valid: false,
			currentVersion: null,
		});
		await expect(rebuildCacheEntry(f.env, undefined, key)).rejects.toMatchObject({
			code: "INVALID_DESCRIPTOR",
		});
		expect(f.calls).toHaveLength(0);
		f.values.set(
			key,
			JSON.stringify({ ...entry, data: { ...entry.data, id: 9, email: "private@example.com" } }),
		);
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({ valid: false });
		expect((await rebuildCacheEntry(f.env, undefined, key)).data).toMatchObject({ id: 1 });
	});
	it("a generation change during loading prevents stale publication", async () => {
		const key = await seed();
		const original = f.values.get(key);
		f.state.afterRead = async () => {
			await bumpThreadMetaGen(f.env, 1);
		};
		await expect(rebuildCacheEntry(f.env, undefined, key)).rejects.toMatchObject({
			stage: "validate",
			code: "VALIDATION_FAILED",
		});
		expect(f.values.get(key)).toBe(original);
	});
	it("same-target concurrent rebuilds share one D1 load and confirmed write", async () => {
		const key = await seed();
		const entered = deferred<void>();
		const finish = deferred<void>();
		f.state.afterRead = async () => {
			entered.resolve();
			await finish.promise;
		};
		f.calls.length = 0;
		vi.mocked(f.env.KV.put).mockClear();
		const tasks = Array.from({ length: 30 }, () => rebuildCacheEntry(f.env, undefined, key));
		await entered.promise;
		expect(f.calls).toHaveLength(1);
		finish.resolve();
		const values = await Promise.all(tasks);
		expect(f.env.KV.put).toHaveBeenCalledTimes(1);
		expect(values.every((value) => value.loadedAt === values[0].loadedAt)).toBe(true);
		(values[0].data as Record<string, unknown>).subject = "local mutation";
		expect(values[1].data).toMatchObject({ subject: "Thread 1" });
	});
	it("delete waits for an earlier rebuild and leaves other entries and D1 unchanged", async () => {
		const key = await seed();
		await getPublicUsers(f.env, undefined, [10], "public");
		const untouched = new Map([...f.values].filter(([name]) => name !== key));
		const entered = deferred<void>();
		const finish = deferred<void>();
		f.state.afterRead = async () => {
			entered.resolve();
			await finish.promise;
		};
		const rebuilding = rebuildCacheEntry(f.env, undefined, key);
		await entered.promise;
		const deleting = deleteCacheEntry(f.env, key);
		finish.resolve();
		await rebuilding;
		await deleting;
		expect(f.values.has(key)).toBe(false);
		expect(f.values).toEqual(untouched);
		expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM threads").get()).toMatchObject({
			count: 1,
		});
	});
	it("a live miss started during deletion cannot refill the deleted entry after completion", async () => {
		const key = await seed();
		f.values.delete(key);
		const deletingStarted = deferred<void>();
		const deleted = deferred<void>();
		const loaded = deferred<unknown>();
		vi.mocked(f.env.KV.delete).mockImplementation(async (name) => {
			deletingStarted.resolve();
			await deleted.promise;
			f.values.delete(name);
		});
		const deletion = deleteCacheEntry(f.env, key);
		await deletingStarted.promise;
		const stale = await rebuildThreadCache(f.env, undefined, descriptor);
		const reading = cacheGetOrSet(f.env, undefined, key, () => loaded.promise, options);
		deleted.resolve();
		await deletion;
		loaded.resolve(stale);
		await reading;
		expect(f.values.has(key)).toBe(false);
	});
	it("delete failure and unsafe runtime keys never report a successful business operation", async () => {
		const key = await seed();
		const original = f.values.get(key);
		vi.mocked(f.env.KV.delete).mockRejectedValue(new Error("429"));
		await expect(deleteCacheEntry(f.env, key)).rejects.toMatchObject({
			code: "DELETE_FAILED",
			stage: "delete",
		});
		expect(f.values.get(key)).toBe(original);
		vi.mocked(f.env.KV.get).mockClear();
		for (const unsafe of [
			"unknown:key",
			"session:secret",
			"auth:refresh:token",
			"thread:meta:gen:1",
		]) {
			await expect(inspectCacheEntry(f.env, unsafe)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
			await expect(deleteCacheEntry(f.env, unsafe)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
		}
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});
	it("rebuild dispatch preserves user audiences and strict mini fields", async () => {
		await getPublicUsers(f.env, undefined, [10], "public");
		const publicKey = await userCacheKey(f.env, {
			family: "user:public:v2",
			params: { id: 10, viewerBucket: "public" },
			scope: "public",
		});
		f.sqlite.exec("UPDATE users SET username = 'Renamed', reg_ip = '8.8.8.8' WHERE id = 10");
		const rebuilt = await rebuildCacheEntry(f.env, undefined, publicKey);
		expect(rebuilt.data).toMatchObject({ id: 10, username: "Renamed" });
		expect(rebuilt.data).not.toHaveProperty("regIp");
		await getUserProfiles(f.env, undefined, [10]);
		expect((await rebuildCacheEntry(f.env, undefined, "user:mini:10")).tier).toBe("LONG");
		const d = {
			family: "user:mini:v1",
			params: { id: 10 },
			scope: "public",
			tier: "LONG" as const,
		};
		await putCacheEnvelope(f.env, "user:mini:10", createCacheEnvelope({ id: 30 }, d));
		expect(await inspectCacheEntry(f.env, "user:mini:10")).toMatchObject({ valid: false });
	});
	it("settings rebuild reloads authoritative values without permission or business effects", async () => {
		f.insert("settings", { key: "site.name", value: "Before", type: "string", updated_at: 0 });
		await getSettings(f.env);
		f.sqlite.prepare("UPDATE settings SET value = 'After' WHERE key = 'site.name'").run();
		f.calls.length = 0;
		const rebuilt = await rebuildCacheEntry(f.env, undefined, "settings:all");
		expect(rebuilt.data).toMatchObject({ "site.name": "After" });
		expect(rebuilt.tier).toBe("LONG");
		expect(f.calls).toHaveLength(1);
	});
});
