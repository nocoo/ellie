import { describe, expect, it, vi } from "vitest";
import { cacheGetOrSet } from "../../../../src/lib/cache/wrap";
import { createMockCtx, makeEnv } from "../../../helpers";

interface Payload {
	v: number;
}

function jsonKV(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	const kv = {
		get: vi.fn(async (key: string, type?: string) => {
			const raw = store.get(key) ?? null;
			if (raw === null) return null;
			if (type === "json") return JSON.parse(raw);
			return raw;
		}),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
	return { kv, store };
}

describe("cache/wrap — cacheGetOrSet", () => {
	it("returns cached value on hit and does not call loader", async () => {
		const { kv } = jsonKV({ k: JSON.stringify({ v: 1 }) });
		const env = makeEnv({ KV: kv });
		const ctx = createMockCtx();
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 99 }));

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 60 });
		expect(out).toEqual({ v: 1 });
		expect(loader).not.toHaveBeenCalled();
	});

	it("on miss: calls loader, returns fresh value, schedules waitUntil write", async () => {
		const { kv, store } = jsonKV();
		const env = makeEnv({ KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 7 }));

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 30 });
		expect(out).toEqual({ v: 7 });
		expect(loader).toHaveBeenCalledTimes(1);

		// Drain the scheduled write.
		await Promise.all(ctx._waitUntilPromises);
		expect(store.get("k")).toBe(JSON.stringify({ v: 7 }));
		expect(kv.put).toHaveBeenCalledWith("k", JSON.stringify({ v: 7 }), { expirationTtl: 30 });
	});

	it("validator returning false forces a miss", async () => {
		const { kv } = jsonKV({ k: JSON.stringify({ wrong: "shape" }) });
		const env = makeEnv({ KV: kv });
		const ctx = createMockCtx();
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 42 }));
		const validator = (val: unknown): val is Payload =>
			typeof val === "object" && val !== null && typeof (val as Payload).v === "number";

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 60, validator });
		expect(out).toEqual({ v: 42 });
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("validator passing returns cached value", async () => {
		const { kv } = jsonKV({ k: JSON.stringify({ v: 5 }) });
		const env = makeEnv({ KV: kv });
		const ctx = createMockCtx();
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 1 }));
		const validator = (val: unknown): val is Payload =>
			typeof val === "object" && val !== null && typeof (val as Payload).v === "number";

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 60, validator });
		expect(out).toEqual({ v: 5 });
		expect(loader).not.toHaveBeenCalled();
	});

	it("KV.get throwing falls through to loader", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(async () => {
					throw new Error("boom");
				}),
				put: vi.fn(async () => {}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace,
		});
		const ctx = createMockCtx();
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 11 }));

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 60 });
		expect(out).toEqual({ v: 11 });
		expect(loader).toHaveBeenCalled();
	});

	it("KV.put throwing does not surface to caller", async () => {
		const env = makeEnv({
			KV: {
				get: vi.fn(async () => null),
				put: vi.fn(async () => {
					throw new Error("kv put down");
				}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace,
		});
		const ctx = createMockCtx() as ExecutionContext & {
			_waitUntilPromises: Promise<unknown>[];
		};
		const loader = vi.fn(async (): Promise<Payload> => ({ v: 3 }));

		const out = await cacheGetOrSet<Payload>(env, ctx, "k", loader, { ttl: 60 });
		expect(out).toEqual({ v: 3 });
		// waitUntil promise should resolve (catch swallows).
		await expect(Promise.all(ctx._waitUntilPromises)).resolves.toBeDefined();
	});
});
