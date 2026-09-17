import type { Env } from "../env";
import {
	recordDelete,
	recordError,
	recordHit,
	recordKvOp,
	recordMiss,
	recordRead,
	scheduleMetricsFlush,
} from "./metrics";
import {
	acceptsCacheValue,
	bypassesCache,
	type CacheGetOrSetOptions,
	cacheWrite,
	metricFamily,
	validateCacheOptions,
} from "./store";

export { CACHE_TTL_SECONDS, getCacheTTL } from "@ellie/types";
export {
	type CacheGetOrSetOptions,
	cacheRead,
	cacheReadMany,
	cacheWrite,
	createCacheEnvelope,
	isCacheEnvelope,
	putCacheEnvelope,
} from "./store";

const MAX_PENDING = 256;
const LOAD_TIMEOUT_MS = 20_000;
const ORIGIN_WINDOW_MS = 60_000;
const MAX_ORIGIN_LOADS_PER_WINDOW = 8192;
const originWindows = new WeakMap<KVNamespace, { startedAt: number; count: number }>();

interface PendingLoad {
	promise: Promise<unknown>;
	work: Promise<unknown>;
	cancelled: boolean;
	settled: boolean;
	outcome: "hit" | "miss";
}

function admitOriginLoad(env: Env): void {
	let window = originWindows.get(env.KV);
	if (!window || Date.now() - window.startedAt >= ORIGIN_WINDOW_MS) {
		window = { startedAt: Date.now(), count: 0 };
		originWindows.set(env.KV, window);
	}
	if (window.count >= MAX_ORIGIN_LOADS_PER_WINDOW) throw new CacheLoadLimitError();
	window.count++;
}

// Only in-progress work is shared. No completed private values, credentials,
// or durable counters are kept here. Different KV bindings never share tasks.
const pendingByNamespace = new WeakMap<KVNamespace, Map<string, PendingLoad>>();
const writeHolds = new WeakMap<KVNamespace, Map<string, number>>();
const mutationQueues = new WeakMap<
	KVNamespace,
	{ tails: Map<string, Promise<unknown>>; count: number }
>();
const MAX_PENDING_MUTATIONS = 1024;

/** Suppress fills started during an explicit write/delete, including late loaders. */
export function holdCacheWrites(env: Env, key: string): () => void {
	let holds = writeHolds.get(env.KV);
	if (!holds) {
		holds = new Map();
		writeHolds.set(env.KV, holds);
	}
	holds.set(key, (holds.get(key) ?? 0) + 1);
	return () => {
		const remaining = (holds.get(key) ?? 1) - 1;
		if (remaining > 0) holds.set(key, remaining);
		else holds.delete(key);
	};
}

function pendingLoads(env: Env): Map<string, PendingLoad> {
	let pending = pendingByNamespace.get(env.KV);
	if (!pending) {
		pending = new Map();
		pendingByNamespace.set(env.KV, pending);
	}
	return pending;
}

export class CacheLoadLimitError extends Error {
	readonly status = 503;
	constructor(message = "Cache origin load budget exhausted; retry later") {
		super(message);
		this.name = "CacheLoadLimitError";
	}
}

/** Business invalidation and Admin rebuilds must finish their KV writes in order. */
export async function runCacheMutation<T>(
	env: Env,
	key: string,
	action: () => Promise<T>,
): Promise<T> {
	let queue = mutationQueues.get(env.KV);
	if (!queue) {
		queue = { tails: new Map(), count: 0 };
		mutationQueues.set(env.KV, queue);
	}
	if (queue.count >= MAX_PENDING_MUTATIONS)
		throw new CacheLoadLimitError("Cache mutation queue is full; retry later");
	queue.count++;
	const release = holdCacheWrites(env, key);
	const previous = queue.tails.get(key) ?? Promise.resolve();
	const tail = previous
		.catch(() => undefined)
		.then(action)
		.finally(() => {
			release();
			queue.count--;
			if (queue.tails.get(key) === tail) queue.tails.delete(key);
		});
	queue.tails.set(key, tail);
	return tail;
}

export async function cacheGetOrSet<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	key: string,
	loader: () => Promise<T>,
	options: CacheGetOrSetOptions<T>,
): Promise<T> {
	validateCacheOptions(options);
	const pending = pendingLoads(env);
	const taskKey = `${options.source ?? "business"}:${options.family}:${options.tier}:${options.scope ?? "public"}:${key}`;
	const family = metricFamily(options);
	recordRead(family);
	const existing = pending.get(taskKey);
	if (existing) {
		const value = await existing.promise;
		if (existing.outcome === "hit") recordHit(family);
		else recordMiss(family);
		return structuredClone(value) as T;
	}
	if (pending.size >= MAX_PENDING) throw new CacheLoadLimitError();
	const task: PendingLoad = {
		promise: Promise.resolve(),
		work: Promise.resolve(),
		cancelled: writeHolds.get(env.KV)?.has(key) ?? false,
		settled: false,
		outcome: "miss",
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const work = async (): Promise<T> => {
		try {
			if (!bypassesCache(env, key, options.family)) recordKvOp(family, "kv-get");
			const value = bypassesCache(env, key, options.family) ? null : await env.KV.get(key, "json");
			if (acceptsCacheValue(value, options)) {
				task.outcome = "hit";
				recordHit(family);
				return value.data;
			}
		} catch {
			recordError(family);
		}
		recordMiss(family);
		admitOriginLoad(env);
		recordKvOp(family, "load");
		let fresh: T;
		try {
			fresh = await loader();
			if (fresh === undefined || (options.validator && !options.validator(fresh))) {
				throw new TypeError("Cache loader returned an invalid value");
			}
		} catch (error) {
			recordError(family);
			recordKvOp(family, "load-error");
			throw error;
		}
		if (!task.cancelled) await cacheWrite(env, ctx, key, fresh, options);
		return fresh;
	};
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			task.cancelled = true;
			reject(new CacheLoadLimitError("Cache origin load timed out; retry later"));
		}, LOAD_TIMEOUT_MS);
	});
	task.work = work().finally(() => {
		task.settled = true;
		clearTimeout(timer);
		if (pending.get(taskKey) === task) pending.delete(taskKey);
		if (ctx) scheduleMetricsFlush(env, ctx);
	});
	// A timeout releases the caller, never the origin's permit. A SQL/KV
	// operation that is still running cannot be counted as completed work.
	task.promise = Promise.race([task.work, timeout]);
	pending.set(taskKey, task);
	if (ctx)
		ctx.waitUntil(
			task.work.then(
				() => undefined,
				() => undefined,
			),
		);
	return structuredClone(await task.promise) as T;
}

/** Fence local outstanding fills before an explicit management mutation. */
export async function settleCacheLoads(env: Env, key: string): Promise<void> {
	const tasks = [...pendingLoads(env)]
		.filter(([taskKey]) => taskKey.endsWith(`:${key}`))
		.map(([, task]) => task);
	for (const task of tasks) task.cancelled = true;
	await Promise.allSettled(tasks.map((task) => task.promise));
	if (tasks.some((task) => !task.settled)) {
		throw new CacheLoadLimitError("An outstanding cache fill has not settled; retry later");
	}
}

export async function cacheDelete(env: Env, key: string, family: string): Promise<boolean> {
	try {
		await runCacheMutation(env, key, async () => {
			await settleCacheLoads(env, key);
			recordKvOp(family, "kv-delete");
			await env.KV.delete(key);
			recordDelete(family);
		});
		return true;
	} catch {
		recordError(family);
		return false;
	}
}
