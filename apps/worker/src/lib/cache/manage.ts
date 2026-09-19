import type { CacheDescriptor, CacheEnvelope, CacheTier } from "@ellie/types";
import type { Env } from "../env";
import { findFamily, type KvFamilySpec, resolveFamilyForKey } from "./kv-registry";
import { acceptsCacheValue, createCacheEnvelope, isCacheEnvelope, putCacheEnvelope } from "./store";
import { CacheLoadLimitError, runCacheMutation, settleCacheLoads } from "./wrap";

type Stage = "read" | "load" | "validate" | "write" | "delete";

export class CacheManagementError extends Error {
	constructor(
		readonly code: string,
		readonly stage: Stage,
		message: string,
	) {
		super(message);
		this.name = "CacheManagementError";
	}
}

export function canRebuildCacheFamily(family: string): boolean {
	const spec = findFamily(family);
	return spec?.status === "shipped" && !!spec.tier && !!spec.loader;
}

function businessEntry(key: string): KvFamilySpec & { tier: CacheTier } {
	const spec = resolveFamilyForKey(key);
	if (!spec?.tier || spec.status !== "shipped" || spec.valueSensitivity === "no-read") {
		throw new CacheManagementError(
			"NOT_ALLOWED",
			"validate",
			"Only enrolled business cache entries can be managed",
		);
	}
	return { ...spec, tier: spec.tier };
}

/** Resolves only normalized parameters and KV versions, never D1 or a loader. */
export async function resolveCacheEntryKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	switch (findFamily(descriptor.family)?.loader) {
		case "reading":
			return (await import("./thread-loaders")).readingCacheKey(env, descriptor);
		case "peripheral":
			return (await import("./peripheral-loaders")).peripheralCacheKey(env, descriptor);
		case "forum":
			return (await import("./forum-read")).forumCacheKey(env, descriptor);
		case "ip":
			return (await import("../../handlers/admin/ip-lookup")).ipLookupCacheKey(descriptor);
		case "admin":
			return (await import("./admin-entity-read")).adminEntityCacheKey(env, descriptor);
		case "catalog":
			return (await import("./catalog-read")).catalogCacheKey(env, descriptor);
		case "user":
			return (await import("./user-read")).userCacheKey(env, descriptor);
		case "private":
			return (await import("./private-read")).privateCacheKey(env, descriptor);
		case "admin-report":
			return (await import("./admin-report-read")).adminReportCacheKey(env, descriptor);
		case "monitor":
			return (await import("./admin-monitor-read")).monitorCacheKey(env, descriptor);
		default:
			throw new CacheManagementError(
				"NOT_REBUILDABLE",
				"validate",
				"No authoritative loader is registered",
			);
	}
}

async function load(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	switch (findFamily(descriptor.family)?.loader) {
		case "reading":
			return (await import("./thread-loaders")).rebuildThreadCache(env, ctx, descriptor);
		case "peripheral":
			return (await import("./peripheral-loaders")).rebuildPeripheralCache(env, ctx, descriptor);
		case "forum":
			return (await import("./forum-read")).rebuildForumCache(env, ctx, descriptor);
		case "ip":
			return (await import("../../handlers/admin/ip-lookup")).rebuildIpLookupCache(env, descriptor);
		case "admin":
			return (await import("./admin-entity-read")).rebuildAdminEntityCache(env, ctx, descriptor);
		case "catalog":
			return (await import("./catalog-read")).rebuildCatalogCache(env, ctx, descriptor);
		case "user":
			return (await import("./user-read")).rebuildUserCache(env, ctx, descriptor);
		case "private":
			return (await import("./private-read")).rebuildPrivateCache(env, ctx, descriptor);
		case "admin-report":
			return (await import("./admin-report-read")).rebuildAdminReportCache(env, ctx, descriptor);
		case "monitor":
			return (await import("./admin-monitor-read")).rebuildMonitorCache(env, ctx, descriptor);
		default:
			throw new CacheManagementError(
				"NOT_REBUILDABLE",
				"load",
				"No authoritative loader is registered",
			);
	}
}

async function dataValidator(
	descriptor: CacheDescriptor,
): Promise<(value: unknown) => value is unknown> {
	let test: ((descriptor: CacheDescriptor, value: unknown) => boolean) | undefined;
	switch (findFamily(descriptor.family)?.loader) {
		case "user":
			test = (await import("./user-read")).isUserCacheData;
			break;
		case "private":
			test = (await import("./private-read")).isPrivateCacheData;
			break;
		case "admin":
			test = (await import("./admin-entity-read")).isAdminEntityCacheData;
			break;
		case "forum":
			test = (await import("./forum-read")).isForumCacheData;
			break;
		case "reading":
			test = (await import("./thread-loaders")).isThreadCacheData;
			break;
		case "admin-report":
			test = (await import("./admin-report-read")).isAdminReportCacheData;
			break;
		case "monitor":
			test = (await import("./admin-monitor-read")).isMonitorCacheData;
			break;
		case "peripheral":
			test = (await import("./peripheral-loaders")).isPeripheralCacheData;
			break;
		case "ip":
			test = (await import("../../handlers/admin/ip-lookup")).isIpLookupCacheData;
			break;
		case "catalog":
			test = (await import("./catalog-read")).isCatalogCacheData;
			break;
	}
	return (value: unknown): value is unknown =>
		test ? test(descriptor, value) : value !== undefined;
}

export interface CacheInspection {
	key: string;
	found: boolean;
	envelope: CacheEnvelope | null;
	raw: unknown;
	valid: boolean;
	sizeBytes: number;
	observedAt: number;
	staleVersion: boolean;
	currentVersion: string | null;
}

/** A diagnostic read never fills, renews TTL, or executes business side effects. */
export async function inspectCacheEntry(env: Env, key: string): Promise<CacheInspection> {
	const spec = businessEntry(key);
	let serialized: string | null;
	try {
		serialized = await env.KV.get(key);
	} catch {
		throw new CacheManagementError("READ_FAILED", "read", "Cache entry could not be read");
	}
	let raw: unknown = serialized;
	if (serialized !== null) {
		try {
			raw = JSON.parse(serialized);
		} catch {
			/* Preserve corrupt text for diagnosis. */
		}
	}
	const envelope = isCacheEnvelope(raw) && raw.family === spec.family ? raw : null;
	let version: string | null = null;
	if (envelope) {
		try {
			version = await resolveCacheEntryKey(env, envelope);
			if (version.includes("!unavailable")) {
				throw new CacheManagementError(
					"VERSION_READ_FAILED",
					"read",
					"Current cache version is unavailable",
				);
			}
		} catch (error) {
			if (error instanceof CacheManagementError && error.stage === "read") throw error;
			// A malformed descriptor is diagnostic data, never a loader input.
			version = null;
		}
	}
	const observedAt = Date.now();
	return {
		key,
		found: serialized !== null,
		envelope,
		raw,
		valid:
			!!envelope &&
			version === key &&
			acceptsCacheValue(envelope, {
				family: spec.family,
				tier: spec.tier,
				params: envelope.params,
				scope: envelope.scope,
				validator: await dataValidator(envelope),
			}),
		sizeBytes: serialized === null ? 0 : new TextEncoder().encode(serialized).byteLength,
		observedAt,
		staleVersion: !!envelope && version !== null && version !== key,
		currentVersion: version,
	};
}

interface Mutation {
	kind: "rebuild" | "delete";
	promise: Promise<unknown>;
}
const mutations = new WeakMap<KVNamespace, Map<string, Mutation>>();

async function fence(env: Env, key: string): Promise<void> {
	try {
		await settleCacheLoads(env, key);
	} catch {
		throw new CacheManagementError(
			"BUSY",
			"validate",
			"An earlier cache fill is still pending; retry later",
		);
	}
}

async function mutate<T>(
	env: Env,
	key: string,
	kind: Mutation["kind"],
	action: () => Promise<T>,
): Promise<T> {
	let targets = mutations.get(env.KV);
	if (!targets) {
		targets = new Map();
		mutations.set(env.KV, targets);
	}
	const previous = targets.get(key);
	if (previous) {
		if (previous.kind === kind) return structuredClone(await previous.promise) as T;
		await previous.promise.catch(() => undefined);
		return mutate(env, key, kind, action);
	}
	if (targets.size >= 32)
		throw new CacheManagementError("BUSY", "validate", "Cache management is busy; retry later");
	const entry: Mutation = { kind, promise: Promise.resolve() };
	entry.promise = runCacheMutation(env, key, action)
		.catch((error) => {
			if (error instanceof CacheLoadLimitError)
				throw new CacheManagementError("BUSY", "validate", error.message);
			throw error;
		})
		.finally(() => {
			if (targets.get(key) === entry) targets.delete(key);
		});
	targets.set(key, entry);
	return structuredClone(await entry.promise) as T;
}

export async function rebuildCacheEntry(
	env: Env,
	ctx: ExecutionContext | undefined,
	key: string,
): Promise<CacheEnvelope> {
	const spec = businessEntry(key);
	return mutate(env, key, "rebuild", async () => {
		const inspected = await inspectCacheEntry(env, key);
		const descriptor = inspected.envelope;
		if (!descriptor || inspected.currentVersion === null) {
			throw new CacheManagementError(
				"INVALID_DESCRIPTOR",
				"validate",
				"Stored parameters and scope are required to rebuild this entry",
			);
		}
		if (inspected.staleVersion)
			throw new CacheManagementError(
				"STALE_VERSION",
				"validate",
				"This entry belongs to an obsolete resource version",
			);
		await fence(env, key);
		let data: unknown;
		try {
			data = await load(env, ctx, descriptor);
		} catch (error) {
			if (error instanceof CacheManagementError) throw error;
			throw new CacheManagementError(
				"LOAD_FAILED",
				"load",
				"Authoritative data could not be rebuilt",
			);
		}
		let envelope: CacheEnvelope;
		try {
			if ((await resolveCacheEntryKey(env, descriptor)) !== key)
				throw new Error("Version changed during rebuild");
			envelope = createCacheEnvelope(data, {
				family: descriptor.family,
				params: descriptor.params,
				scope: descriptor.scope,
				tier: spec.tier,
				validator: await dataValidator(descriptor),
			});
		} catch {
			throw new CacheManagementError(
				"VALIDATION_FAILED",
				"validate",
				"Rebuilt data or resource version is no longer valid",
			);
		}
		await fence(env, key);
		if ((await resolveCacheEntryKey(env, descriptor)) !== key) {
			throw new CacheManagementError(
				"STALE_VERSION",
				"validate",
				"The resource version changed before the cache write",
			);
		}
		try {
			await putCacheEnvelope(env, key, envelope, "admin");
		} catch {
			throw new CacheManagementError("WRITE_FAILED", "write", "Cache write was not confirmed");
		}
		return envelope;
	});
}

export async function deleteCacheEntry(env: Env, key: string): Promise<void> {
	businessEntry(key);
	return mutate(env, key, "delete", async () => {
		await fence(env, key);
		try {
			await env.KV.delete(key);
		} catch {
			throw new CacheManagementError("DELETE_FAILED", "delete", "Cache deletion was not confirmed");
		}
	});
}
