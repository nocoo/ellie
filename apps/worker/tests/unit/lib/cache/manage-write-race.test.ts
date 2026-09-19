import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rebuildCacheEntry } from "../../../../src/lib/cache/manage";
import { CacheLoadLimitError, runCacheMutation } from "../../../../src/lib/cache/wrap";
import { getSettings, upsertSettings } from "../../../../src/lib/settings";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, err) => {
		resolve = done;
		reject = err;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(1_700_000_000_000);
	f = readingFixture();
	f.thread(1);
	f.post(1);
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("manage-write-race — business cacheDelete and management serialization", () => {
	it("rebuild in-flight while upsertSettings updates D1 serializes deletion after rebuild, never leaving stale Before in cache", async () => {
		// 1. Seed site.name = Before
		f.insert("settings", {
			key: "site.name",
			value: "Before",
			type: "string",
			updated_at: 0,
		});

		// 2. Warm cache
		const initial = await getSettings(f.env);
		expect(initial["site.name"]).toBe("Before");
		expect(f.values.has("settings:all")).toBe(true);

		// 3. Start rebuildCacheEntry("settings:all"), pause after SELECT captured Before
		const selectCaptured = deferred<void>();
		const allowSelectToFinish = deferred<void>();

		f.state.afterRead = async (sql: string) => {
			if (sql.includes("FROM settings")) {
				selectCaptured.resolve();
				await allowSelectToFinish.promise;
			}
		};

		const rebuildPromise = rebuildCacheEntry(f.env, undefined, "settings:all");

		// Wait until rebuild's loader has executed SELECT capturing 'Before'
		await selectCaptured.promise;

		// 4. Start upsertSettings with 'After' while rebuild is paused before write
		// Because runCacheMutation serializes per-key on settings:all, upsertSettings's cacheDelete will wait behind rebuild
		const upsertPromise = upsertSettings(f.env, { "site.name": "After" });

		// Verify DB was already updated to After
		const dbRow = f.sqlite.prepare("SELECT value FROM settings WHERE key = 'site.name'").get() as {
			value: string;
		};
		expect(dbRow.value).toBe("After");

		// 5. Release rebuild's SELECT reading gate
		allowSelectToFinish.resolve();

		// Await both operations
		await rebuildPromise;
		await upsertPromise;

		// 6. Verify final state: settings:all was invalidated by the queued cacheDelete, NOT stale Before
		expect(f.values.has("settings:all")).toBe(false);

		// 7. Fresh read loads After from D1 and repopulates
		const fresh = await getSettings(f.env);
		expect(fresh["site.name"]).toBe("After");
	});

	it("deletion queued while KV.put is in-flight waits for put completion before deleting (catches TOCTOU)", async () => {
		f.insert("settings", {
			key: "site.name",
			value: "Before",
			type: "string",
			updated_at: 0,
		});
		await getSettings(f.env);

		// Control put completion via fixture's built-in state.writeGate
		const putReached = deferred<void>();
		let releaseGate!: () => void;
		f.state.writeGate = new Promise<void>((r) => {
			releaseGate = r;
		});

		// Monitor when KV.put was called on settings:all
		const origPut = vi.mocked(f.env.KV.put).getMockImplementation();
		vi.mocked(f.env.KV.put).mockImplementation(
			async (key: string, value: string, opts?: unknown) => {
				if (key === "settings:all") {
					putReached.resolve();
				}
				return origPut?.(key, value, opts as KVNamespacePutOptions);
			},
		);

		const rebuildPromise = rebuildCacheEntry(f.env, undefined, "settings:all");

		// Wait until rebuild reached KV.put
		await putReached.promise;

		// Now trigger upsertSettings (which updates D1 and queues cacheDelete for settings:all)
		const upsertPromise = upsertSettings(f.env, { "site.name": "After" });

		// Release the in-flight put through writeGate
		releaseGate();
		f.state.writeGate = undefined;

		await rebuildPromise;
		await upsertPromise;

		// Key MUST be deleted by the serialized cacheDelete, never left holding the put envelope
		expect(f.values.has("settings:all")).toBe(false);

		const fresh = await getSettings(f.env);
		expect(fresh["site.name"]).toBe("After");
	});

	it("failed management operation releases mutation queue so subsequent mutations proceed", async () => {
		f.insert("settings", {
			key: "site.name",
			value: "Before",
			type: "string",
			updated_at: 0,
		});
		await getSettings(f.env);

		// Cause rebuild load to fail via queryError
		f.state.queryError = true;
		await expect(rebuildCacheEntry(f.env, undefined, "settings:all")).rejects.toMatchObject({
			code: "LOAD_FAILED",
			stage: "load",
		});

		// Clear error
		f.state.queryError = false;

		// Subsequent upsertSettings succeeds and queue is not stuck
		await expect(upsertSettings(f.env, { "site.name": "After" })).resolves.toBeUndefined();
		expect(f.values.has("settings:all")).toBe(false);
	});

	it("caps total pending explicit mutations at 1024 and recovers capacity on completion", async () => {
		const running: Promise<unknown>[] = [];
		const gates: (() => void)[] = [];

		// Enqueue 1024 mutations across distinct keys
		for (let i = 0; i < 1024; i++) {
			const k = `test:key:${i}`;
			const { promise, resolve } = deferred<void>();
			gates.push(resolve);
			running.push(
				runCacheMutation(f.env, k, async () => {
					await promise;
				}),
			);
		}

		// 1025th mutation throws CacheLoadLimitError (503)
		await expect(runCacheMutation(f.env, "test:key:overflow", async () => {})).rejects.toThrow(
			CacheLoadLimitError,
		);

		// Release all held mutations
		for (const g of gates) g();
		await Promise.all(running);

		// Capacity is recovered
		await expect(runCacheMutation(f.env, "test:key:recovered", async () => "ok")).resolves.toBe(
			"ok",
		);
	});
});
