// Admin KV monitor — read + safe-mutation handlers backing the
// `/admin/statistics/kv` page. All endpoints are gated by Key B at
// the router level (`apiKey` middleware). `withEntityAuth` preserves
// the common admin handler signature.
//
// Design contract (see thread #ellie-后端细节:bdcb7183 v3 plan):
//
// 1. Family declared in `kv-registry.ts` is the single source of truth.
//    The handler never accepts arbitrary KV operations — every mutation
//    is dispatched through a typed `KvRefreshAction`.
//
// 2. Sensitivity masking is enforced server-side, not in the front end:
//    - `nameSensitivity: "hide"` → never return sample keys; `getKey`
//      refuses with `KV_KEY_NAME_HIDDEN`.
//    - `nameSensitivity: "mask"` → sample keys / `listFamily` results
//      have their suffix masked via `maskKeyName`.
//    - `valueSensitivity: "no-read"` → `getKey` refuses with
//      `KV_KEY_VALUE_FORBIDDEN` even on otherwise public-name keys.
//
// 3. Audit log on business-cache mutations (`writeAdminLog` actions
//    `kv.bump_gen`, `kv.delete_key`). Audit details only carry the
//    family + masked key + category — never the raw value.
//
// 4. Cloudflare KV API quirks the handler papers over:
//    - `getWithMetadata` does NOT return expiration → for detail view
//      we additionally `KV.list({prefix: key, limit: 1})` and look up
//      the matching entry to surface `expiration`. Returns `null`
//      ("unknown") when the row is not in that page.
//    - `KV.list` is eventually-consistent and may return empty pages
//      with `list_complete: false`. Pagination terminates ONLY on
//      `list_complete === true`.
//
// 5. Overview reads the last administrator-triggered KV snapshot. Only
//    POST snapshot scans metadata. Metrics exposes legacy observations;
//    ordinary traffic no longer collects or persists monitoring counters.

import {
	type CacheParams,
	type CacheTier,
	decodeGenericCursor,
	encodeGenericCursor,
} from "@ellie/types";
import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	captureMonitorSnapshot,
	getMonitorMetrics,
	listExactMetadata,
	loadMonitorMetrics,
	parseMonitorMetricsQuery,
	readMonitorSnapshot,
} from "../../lib/cache/admin-monitor-read";
import {
	bumpDigestGen,
	bumpForumTreeGen,
	bumpPostListGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
} from "../../lib/cache/invalidate";
import { findFamily, type KvFamilySpec, resolveFamilyForKey } from "../../lib/cache/kv-registry";
import {
	CacheManagementError,
	canRebuildCacheFamily,
	deleteCacheEntry,
	inspectCacheEntry,
	rebuildCacheEntry,
	resolveCacheEntryKey,
} from "../../lib/cache/manage";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { invalidateUserCache } from "../../lib/user-cache";
import { errorResponse } from "../../middleware/error";

const kvConfig: EntityConfig = {
	table: "forums",
	entityName: "KV_MONITOR",
	auth: "admin",
	columns: "id",
	mapper: (row) => row,
	notFoundCode: "KV_FAMILY_NOT_FOUND",
};

// ─── Sensitivity masking helpers ──────────────────────────────────

/**
 * Hash a string to a short hex digest used to mask user identifiers
 * inside key names. Not a security primitive — only there so two
 * keys for the same user collapse to the same masked label so the
 * UI can show "1 user" vs "many".
 *
 * Uses SubtleCrypto SHA-256 (available in Workers runtime). Returns
 * the first 6 hex chars.
 */
async function shortHash(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < 3; i++) {
		out += bytes[i].toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * Mask the variable portion of an IPv4-style key suffix. Keeps the
 * first two octets and replaces the rest. IPv6 fallback: keep the
 * first 4 hex blocks.
 */
function maskIpSuffix(suffix: string): string {
	if (suffix.includes(".")) {
		const parts = suffix.split(".");
		if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
	}
	if (suffix.includes(":")) {
		const parts = suffix.split(":");
		if (parts.length >= 4) return `${parts.slice(0, 4).join(":")}::*`;
	}
	return "***";
}

/**
 * Apply the family's masking rule to a raw key. Pure for `public`,
 * async for `mask` because user-id masking uses SubtleCrypto.
 *
 * The handler never returns `hide` keys to clients — they're filtered
 * out before this function is called.
 */
async function maskKeyName(key: string, family: KvFamilySpec): Promise<string> {
	if (family.nameSensitivity === "public") return key;
	if (family.nameSensitivity === "hide") return "[hidden]";
	const suffix = key.slice(family.listPrefix.length);
	if (suffix.length === 0) return key;
	switch (family.family) {
		case "login-ip":
		case "login-lockout-ip":
		case "reg-ip":
		case "chk-usr-ip":
			return `${family.listPrefix}${maskIpSuffix(suffix)}`;
		case "email_verify":
		case "email_verify_lock": {
			const h = await shortHash(suffix);
			return `${family.listPrefix}u_${h}`;
		}
		default:
			return `${family.listPrefix}***`;
	}
}

// ─── KV.list pagination helpers ───────────────────────────────────

/**
 * Look up the `expiration` for an exact key by paginating
 * `KV.list({prefix: key})` until either the entry shows up or
 * `list_complete === true`. Bounded by `hardCap` total scanned entries
 * (default 1000) so a runaway prefix can't blow up the request. Returns
 * `null` when not found within the cap or on transient errors —
 * "unknown" is acceptable in the detail UI.
 */
async function probeExpirationFor(env: Env, key: string, hardCap = 1000): Promise<number | null> {
	try {
		let cursor: string | undefined;
		let scanned = 0;
		while (scanned < hardCap) {
			const page = await env.KV.list({ prefix: key, cursor, limit: 1000 });
			for (const entry of page.keys) {
				if (entry.name === key) return entry.expiration ?? null;
			}
			scanned += page.keys.length;
			if (page.list_complete) return null;
			cursor = page.cursor;
		}
		return null;
	} catch {
		return null;
	}
}

type CacheLifecycle =
	| "valid"
	| "stale-version"
	| "logically-expired"
	| "not-found"
	| "not-enrolled"
	| "read-failed"
	| "restricted"
	| "runtime-state"
	| "diagnostic-snapshot";
const UTF8 = new TextEncoder();
const UNAVAILABLE_GEN = "!unavailable";

function isUnavailableGen(value: string): boolean {
	return value === UNAVAILABLE_GEN || value.includes(UNAVAILABLE_GEN);
}

function isRuntimeFamily(spec: KvFamilySpec): boolean {
	return (
		spec.category === "session" ||
		spec.category === "rate-limit" ||
		spec.category === "throttle" ||
		spec.category === "gen" ||
		spec.category === "sticky-stats" ||
		spec.category === "snapshot"
	);
}

function tierFromTtl(ttl: KvFamilySpec["ttl"]): CacheTier | null {
	if (ttl === 60) return "SHORT";
	if (ttl === 1800) return "MEDIUM";
	if (ttl === 86400) return "LONG";
	return null;
}

function familyActions(spec: KvFamilySpec): {
	inspect: boolean;
	rebuild: boolean;
	deleteEntry: boolean;
	invalidateGroup: boolean;
	restriction: string | null;
} {
	const runtime = isRuntimeFamily(spec);
	const hide = spec.nameSensitivity === "hide";
	const shipped = spec.status === "shipped";
	return {
		inspect: !hide,
		rebuild: canRebuildCacheFamily(spec.family),
		deleteEntry: !!spec.tier && shipped && spec.valueSensitivity !== "no-read" && !hide,
		invalidateGroup: spec.refresh.kind.startsWith("bump-"),
		restriction: runtime
			? "runtime-state"
			: hide
				? "name-hidden"
				: spec.valueSensitivity === "no-read"
					? "value-forbidden"
					: shipped
						? null
						: spec.status,
	};
}

function readListMetadata(entry: { metadata?: unknown }): {
	schemaVersion: number | null;
	family: string | null;
	tier: CacheTier | null;
	loadedAt: number | null;
	expiresAt: number | null;
	sizeBytes: number | null;
	contentUtf8Bytes: number | null;
} {
	const meta = entry.metadata;
	if (!meta || typeof meta !== "object") {
		return {
			schemaVersion: null,
			family: null,
			tier: null,
			loadedAt: null,
			expiresAt: null,
			sizeBytes: null,
			contentUtf8Bytes: null,
		};
	}
	const o = meta as Record<string, unknown>;
	const tier =
		o.tier === "SHORT" || o.tier === "MEDIUM" || o.tier === "HOUR" || o.tier === "LONG"
			? o.tier
			: null;
	const sizeBytes = typeof o.sizeBytes === "number" ? o.sizeBytes : null;
	const contentUtf8Bytes = typeof o.contentUtf8Bytes === "number" ? o.contentUtf8Bytes : sizeBytes;
	return {
		schemaVersion: typeof o.schemaVersion === "number" ? o.schemaVersion : null,
		family: typeof o.family === "string" ? o.family : null,
		tier,
		loadedAt: typeof o.loadedAt === "number" ? o.loadedAt : null,
		expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : null,
		sizeBytes,
		contentUtf8Bytes,
	};
}

function canInspectViaManage(spec: KvFamilySpec): boolean {
	return !!spec.tier && spec.status === "shipped" && spec.valueSensitivity !== "no-read";
}
const KV_AUDIT_ACTIONS = ["kv.bump_gen", "kv.delete_key", "kv.rebuild", "kv.invalidate_group"];

// ─── Body / param parsing ─────────────────────────────────────────

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const text = await request.text();
		if (!text) return {};
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readQuery(request: Request, key: string): string | null {
	const url = new URL(request.url);
	const v = url.searchParams.get(key);
	return v && v.length > 0 ? v : null;
}

// ─── GET /api/admin/kv/overview ───────────────────────────────────
//
// Returns one row per declared family with current presence/count and
// a small sample of (masked) key names. Counts are bounded by the
// per-family list cap so a runaway prefix can't blow up the response.

export const overview = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const data = await readMonitorSnapshot(env);
		return jsonNoStoreResponse(
			data ?? { families: [], observedAt: null, source: "registry+kv-list-metadata" },
			origin,
		);
	},
);

export const snapshot = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		return jsonNoStoreResponse(
			await captureMonitorSnapshot(env),
			request.headers.get("Origin") ?? undefined,
		);
	},
);

// ─── GET /api/admin/kv/list ───────────────────────────────────────
//
// Paginated list of keys for one family. Always applies sensitivity
// masking to the key names; refuses entirely when `nameSensitivity ===
// "hide"`. Returns expirations from the KV.list response (already an
// absolute unix-second value when set).
const LIST_PAGE_LIMIT = 100;
const LIST_MAX_PAGES = 10;

/**
 * Paginate `KV.list` for a `prefix`-kind family until either `limit`
 * owned keys are collected or KV reports `list_complete`. Filters out
 * sibling families that share the same listPrefix (e.g. `user:mini:v2:*`
 * keys are skipped when listing the `user:mini:v1` family). Bounded
 * by `LIST_MAX_PAGES` so a pathological family of mostly-sibling keys
 * cannot starve the request loop.
 */
async function collectOwnedKeys(
	env: Env,
	spec: KvFamilySpec,
	limit: number,
	startCursor: string | undefined,
): Promise<{
	owned: { name: string; expiration?: number; metadata?: unknown }[];
	cursor: string | undefined;
	listComplete: boolean;
}> {
	const owned: { name: string; expiration?: number; metadata?: unknown }[] = [];
	let nextCursor: string | undefined = startCursor;
	let listComplete = false;
	for (let page = 0; page < LIST_MAX_PAGES; page++) {
		const result = await env.KV.list({
			prefix: spec.listPrefix,
			cursor: nextCursor,
			limit,
		});
		for (const k of result.keys) {
			if (resolveFamilyForKey(k.name)?.family === spec.family) {
				owned.push(k);
				if (owned.length >= limit) break;
			}
		}
		if (result.list_complete) {
			listComplete = true;
			nextCursor = undefined;
			break;
		}
		nextCursor = result.cursor;
		if (owned.length >= limit) break;
	}
	return { owned, cursor: nextCursor, listComplete };
}
const PARAMS_QUERY_MAX = 2048;
const PARAMS_FIELD_MAX = 32;
const SCOPE_QUERY_MAX = 128;

function parseCacheParams(raw: string | null): CacheParams | null | "invalid" {
	if (!raw) return null;
	if (raw.length > PARAMS_QUERY_MAX) return "invalid";
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return "invalid";
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length > PARAMS_FIELD_MAX) return "invalid";
		if (
			entries.some(
				([, item]) =>
					item !== null &&
					typeof item !== "string" &&
					typeof item !== "boolean" &&
					!(typeof item === "number" && Number.isFinite(item)),
			)
		)
			return "invalid";
		return value as CacheParams;
	} catch {
		return "invalid";
	}
}

function parseScopeQuery(raw: string | null): string | "invalid" {
	if (!raw) return "public";
	if (raw.length > SCOPE_QUERY_MAX) return "invalid";
	return raw;
}

async function listedKeyRow(
	spec: KvFamilySpec,
	entry: { name: string; expiration?: number; metadata?: unknown },
	locate?: { params: CacheParams | null; scope: string | null },
) {
	const meta = readListMetadata(entry);
	return {
		key: await maskKeyName(entry.name, spec),
		rawKey: spec.nameSensitivity === "public" ? entry.name : null,
		expiration: entry.expiration ?? null,
		loadedAt: meta.loadedAt,
		expiresAt: meta.expiresAt,
		schemaVersion: meta.schemaVersion,
		family: meta.family ?? spec.family,
		tier: meta.tier ?? spec.tier ?? tierFromTtl(spec.ttl),
		sizeBytes: meta.sizeBytes ?? meta.contentUtf8Bytes,
		contentUtf8Bytes: meta.contentUtf8Bytes,
		scope: locate?.scope ?? null,
		params: locate?.params ?? null,
	};
}

async function listExactName(
	env: Env,
	spec: KvFamilySpec,
	name: string,
	origin: string | undefined,
	locate?: { params: CacheParams | null; scope: string | null },
): Promise<Response> {
	if (resolveFamilyForKey(name)?.family !== spec.family) {
		return jsonNoStoreResponse(
			{
				family: spec.family,
				keys: [],
				cursor: null,
				listComplete: true,
				countKind: "observed",
				observedAt: Date.now(),
				actions: familyActions(spec),
			},
			origin,
		);
	}
	const found = await listExactMetadata(env, name);
	if (found.truncated && !found.key) {
		return jsonNoStoreResponse(
			{
				family: spec.family,
				keys: [],
				cursor: null,
				listComplete: false,
				countKind: "unknown",
				observedAt: Date.now(),
				actions: familyActions(spec),
			},
			origin,
		);
	}
	return jsonNoStoreResponse(
		{
			family: spec.family,
			keys: found.key ? [await listedKeyRow(spec, found.key, locate)] : [],
			cursor: null,
			listComplete: !found.truncated,
			countKind: "observed",
			observedAt: Date.now(),
			actions: familyActions(spec),
		},
		origin,
	);
}

async function resolveLocatedName(
	env: Env,
	spec: KvFamilySpec,
	params: CacheParams,
	scope: string,
): Promise<string> {
	return resolveCacheEntryKey(env, { family: spec.family, params, scope });
}

async function listSingletonFamily(
	env: Env,
	spec: KvFamilySpec,
	origin: string | undefined,
): Promise<Response> {
	return listExactName(env, spec, spec.listPrefix, origin);
}

export const listFamily = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const familyParam = readQuery(request, "family");
		if (!familyParam) {
			return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		}
		const spec = findFamily(familyParam);
		if (!spec) {
			return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
		}
		if (spec.nameSensitivity === "hide") {
			return errorResponse("KV_KEY_NAME_HIDDEN", 403, { family: spec.family }, origin);
		}
		const locateKey = readQuery(request, "key");
		const locateParams = parseCacheParams(readQuery(request, "params"));
		const locateScope = parseScopeQuery(readQuery(request, "scope"));
		if (locateParams === "invalid" || locateScope === "invalid") {
			return errorResponse("INVALID_DESCRIPTOR", 400, undefined, origin);
		}
		if (locateKey && locateParams) {
			return errorResponse("UNKNOWN_KEYS", 400, { rejected: ["key", "params"] }, origin);
		}
		if (locateKey) {
			return listExactName(env, spec, locateKey, origin);
		}
		if (locateParams) {
			try {
				const name = await resolveLocatedName(env, spec, locateParams, locateScope);
				return listExactName(env, spec, name, origin, {
					params: locateParams,
					scope: locateScope,
				});
			} catch (err) {
				if (err instanceof CacheManagementError) {
					return errorResponse(err.code, 400, { family: spec.family }, origin);
				}
				if (err instanceof TypeError) {
					return errorResponse("INVALID_DESCRIPTOR", 400, { family: spec.family }, origin);
				}
				throw err;
			}
		}
		if (spec.keyKind === "exact") {
			return listSingletonFamily(env, spec, origin);
		}
		const cursor = readQuery(request, "cursor") ?? undefined;
		const limitRaw = readQuery(request, "limit");
		const limit = Math.min(
			Math.max(Number.parseInt(limitRaw ?? "", 10) || LIST_PAGE_LIMIT, 1),
			LIST_PAGE_LIMIT,
		);
		const {
			owned,
			cursor: nextCursor,
			listComplete,
		} = await collectOwnedKeys(env, spec, limit, cursor);
		const masked = await Promise.all(owned.slice(0, limit).map((k) => listedKeyRow(spec, k)));
		return jsonNoStoreResponse(
			{
				family: spec.family,
				keys: masked,
				cursor: listComplete ? null : (nextCursor ?? null),
				listComplete,
				countKind: listComplete ? "observed" : "at-least",
				observedAt: Date.now(),
				actions: familyActions(spec),
			},
			origin,
		);
	},
);

// ─── GET /api/admin/kv/get ────────────────────────────────────────
//
// Single key detail. Refuses when `valueSensitivity === "no-read"` so
// auth tokens / verification codes can never leak through this path.
// For `valueSensitivity === "mask-value"` we return only size +
// metadata, never the raw value (protects rate-limit counters etc.).

function slicePreview(
	previewValue: unknown,
	contentOffset: number,
	contentLimit: number | null,
): {
	rendered: unknown;
	contentTruncated: boolean;
	contentRange?: { offset: number; length: number; total: number };
} {
	if (previewValue === null || contentLimit === null) {
		return { rendered: previewValue, contentTruncated: false };
	}
	const text =
		typeof previewValue === "string" ? previewValue : (JSON.stringify(previewValue, null, 2) ?? "");
	const slice = text.slice(contentOffset, contentOffset + contentLimit);
	return {
		rendered: slice,
		contentTruncated: contentOffset + slice.length < text.length || contentOffset > 0,
		contentRange: { offset: contentOffset, length: slice.length, total: text.length },
	};
}

function inspectLifecycle(input: {
	found: boolean;
	valid: boolean;
	staleVersion: boolean;
	restricted: boolean;
	runtimeState: boolean;
	readFailed: boolean;
	enrolled: boolean;
	hasEnvelope: boolean;
	expiresAt: number | null;
	observedAt: number;
}): CacheLifecycle {
	if (input.readFailed) return "read-failed";
	if (input.runtimeState) return "runtime-state";
	if (input.restricted) return "restricted";
	if (!input.enrolled) return "not-enrolled";
	if (!input.found) return "not-found";
	if (input.valid) return "valid";
	if (input.expiresAt !== null && input.expiresAt <= input.observedAt) {
		return input.staleVersion ? "diagnostic-snapshot" : "logically-expired";
	}
	if (input.staleVersion) return "stale-version";
	if (input.hasEnvelope) return "diagnostic-snapshot";
	return "not-enrolled";
}

function mayPreviewScope(scope: string | null, restricted: boolean): boolean {
	if (restricted) return false;
	if (scope === "internal") return true;
	return true;
}

interface InspectCtx {
	maskedKey: string;
	rawKey: string | null;
	runtimeState: boolean;
	restricted: boolean;
	actions: ReturnType<typeof familyActions>;
}

function inspectReadFailed(spec: KvFamilySpec, ctx: InspectCtx): Record<string, unknown> {
	return {
		family: spec.family,
		key: ctx.maskedKey,
		rawKey: ctx.rawKey,
		value: null,
		valueMasked: ctx.restricted,
		valueByteSize: 0,
		contentUtf8Bytes: null,
		metadata: null,
		expiration: null,
		physicalExpiration: null,
		observedAt: Date.now(),
		status: "read-failed",
		schemaVersion: null,
		tier: spec.tier ?? tierFromTtl(spec.ttl),
		params: null,
		scope: null,
		loadedAt: null,
		expiresAt: null,
		remainingMs: null,
		footprint: { kind: "unknown", bytes: null },
		restricted: ctx.restricted,
		contentTruncated: false,
		actions: ctx.actions,
		found: false,
		valid: false,
	};
}

async function inspectEnrolledPayload(
	env: Env,
	spec: KvFamilySpec,
	key: string,
	contentOffset: number,
	contentLimit: number | null,
	ctx: InspectCtx,
): Promise<Record<string, unknown>> {
	try {
		const inspected = await inspectCacheEntry(env, key);
		const envelope = inspected.envelope;
		const expiresAt = envelope?.expiresAt ?? null;
		const scope = envelope?.scope ?? null;
		const previewAllowed = mayPreviewScope(scope, ctx.restricted);
		const previewValue = previewAllowed ? (envelope ? envelope.data : inspected.raw) : null;
		const sliced = slicePreview(previewValue, contentOffset, contentLimit);
		const expiration = inspected.found ? await probeExpirationFor(env, key) : null;
		const status = inspectLifecycle({
			found: inspected.found,
			valid: inspected.valid,
			staleVersion: inspected.staleVersion,
			restricted: ctx.restricted,
			runtimeState: ctx.runtimeState,
			readFailed: false,
			enrolled: true,
			hasEnvelope: envelope !== null,
			expiresAt,
			observedAt: inspected.observedAt,
		});
		const sizeBytes = inspected.found ? inspected.sizeBytes : null;
		return {
			family: spec.family,
			key: ctx.maskedKey,
			rawKey: ctx.rawKey,
			value: sliced.rendered,
			valueMasked: ctx.restricted,
			valueByteSize: inspected.sizeBytes,
			contentUtf8Bytes: sizeBytes,
			sizeBytes,
			metadata: envelope
				? {
						schemaVersion: envelope.schemaVersion,
						family: envelope.family,
						tier: envelope.tier,
						loadedAt: envelope.loadedAt,
						expiresAt: envelope.expiresAt,
						sizeBytes,
						contentUtf8Bytes: sizeBytes,
					}
				: null,
			expiration,
			physicalExpiration: expiration,
			observedAt: inspected.observedAt,
			status,
			schemaVersion: envelope?.schemaVersion ?? null,
			tier: envelope?.tier ?? spec.tier ?? tierFromTtl(spec.ttl),
			params: envelope?.params ?? null,
			scope,
			staleVersion: inspected.staleVersion,
			currentVersion: inspected.currentVersion,
			adminOnlyPreview: scope === "internal",
			loadedAt: envelope?.loadedAt ?? null,
			expiresAt,
			remainingMs: expiresAt === null ? null : expiresAt - inspected.observedAt,
			footprint:
				sizeBytes === null
					? { kind: "unknown", bytes: null }
					: { kind: "observed", bytes: sizeBytes },
			restricted: ctx.restricted,
			contentTruncated: sliced.contentTruncated,
			contentRange: sliced.contentRange,
			actions: ctx.actions,
			earliestDependencyExpiresAt: expiresAt,
			found: inspected.found,
			valid: inspected.valid,
		};
	} catch (err) {
		if (
			err instanceof CacheManagementError &&
			(err.code === "READ_FAILED" || err.code === "VERSION_READ_FAILED")
		) {
			return inspectReadFailed(spec, ctx);
		}
		throw err;
	}
}

async function inspectRawPayload(
	env: Env,
	spec: KvFamilySpec,
	key: string,
	contentOffset: number,
	contentLimit: number | null,
	ctx: InspectCtx,
): Promise<Record<string, unknown>> {
	let value: string | null = null;
	let metadata: unknown = null;
	let readFailed = false;
	try {
		const got = await env.KV.getWithMetadata(key);
		value = got.value;
		metadata = got.metadata;
	} catch {
		readFailed = true;
	}
	const expiration = value === null ? null : await probeExpirationFor(env, key);
	const contentUtf8Bytes = value === null ? null : UTF8.encode(value).byteLength;
	let parsedValue: unknown = value;
	if (value !== null) {
		try {
			parsedValue = JSON.parse(value);
		} catch {
			parsedValue = value;
		}
	}
	const previewValue = ctx.restricted ? null : parsedValue;
	const sliced = slicePreview(previewValue, contentOffset, contentLimit);
	const listMeta = readListMetadata({ metadata });
	const status = inspectLifecycle({
		found: value !== null,
		valid: false,
		staleVersion: false,
		restricted: ctx.restricted,
		runtimeState: ctx.runtimeState,
		readFailed,
		enrolled: false,
		hasEnvelope: false,
		expiresAt: listMeta.expiresAt,
		observedAt: Date.now(),
	});
	return {
		family: spec.family,
		key: ctx.maskedKey,
		rawKey: ctx.rawKey,
		value: sliced.rendered,
		valueMasked: ctx.restricted,
		valueByteSize: contentUtf8Bytes ?? 0,
		contentUtf8Bytes,
		sizeBytes: listMeta.sizeBytes ?? contentUtf8Bytes,
		metadata: metadata ?? null,
		expiration,
		physicalExpiration: expiration,
		observedAt: Date.now(),
		status,
		schemaVersion: listMeta.schemaVersion,
		tier: listMeta.tier ?? spec.tier ?? tierFromTtl(spec.ttl),
		params: null,
		scope: null,
		loadedAt: listMeta.loadedAt,
		expiresAt: listMeta.expiresAt,
		remainingMs: listMeta.expiresAt === null ? null : listMeta.expiresAt - Date.now(),
		footprint:
			contentUtf8Bytes === null
				? { kind: "unknown", bytes: null }
				: { kind: "observed", bytes: contentUtf8Bytes },
		restricted: ctx.restricted,
		contentTruncated: sliced.contentTruncated,
		contentRange: sliced.contentRange,
		actions: ctx.actions,
		earliestDependencyExpiresAt: listMeta.expiresAt,
		found: value !== null,
		valid: false,
	};
}

async function inspectKeyPayload(
	env: Env,
	spec: KvFamilySpec,
	key: string,
	contentOffset: number,
	contentLimit: number | null,
): Promise<Record<string, unknown>> {
	const ctx: InspectCtx = {
		maskedKey: await maskKeyName(key, spec),
		rawKey: spec.nameSensitivity === "public" ? key : null,
		runtimeState: isRuntimeFamily(spec),
		restricted: spec.valueSensitivity !== "public",
		actions: familyActions(spec),
	};
	if (canInspectViaManage(spec)) {
		return inspectEnrolledPayload(env, spec, key, contentOffset, contentLimit, ctx);
	}
	return inspectRawPayload(env, spec, key, contentOffset, contentLimit, ctx);
}

async function resolveInspectKey(
	env: Env,
	request: Request,
	origin: string | undefined,
): Promise<{ key: string } | Response> {
	const key = readQuery(request, "key");
	const familyParam = readQuery(request, "family");
	const locateParams = parseCacheParams(readQuery(request, "params"));
	const locateScope = parseScopeQuery(readQuery(request, "scope"));
	if (locateParams === "invalid" || locateScope === "invalid") {
		return errorResponse("INVALID_DESCRIPTOR", 400, undefined, origin);
	}
	if (key && locateParams) {
		return errorResponse("UNKNOWN_KEYS", 400, { rejected: ["key", "params"] }, origin);
	}
	if (key) return { key };
	if (!familyParam || !locateParams) return errorResponse("MISSING_KEY", 400, undefined, origin);
	const spec = findFamily(familyParam);
	if (!spec) return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
	try {
		return { key: await resolveLocatedName(env, spec, locateParams, locateScope) };
	} catch (err) {
		if (err instanceof CacheManagementError) {
			return errorResponse(err.code, 400, { family: spec.family }, origin);
		}
		if (err instanceof TypeError) {
			return errorResponse("INVALID_DESCRIPTOR", 400, { family: spec.family }, origin);
		}
		throw err;
	}
}

export const getKey = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const located = await resolveInspectKey(env, request, origin);
		if (located instanceof Response) return located;
		const { key } = located;
		const spec = resolveFamilyForKey(key);
		if (!spec) {
			return errorResponse("KV_FAMILY_NOT_FOUND", 404, { key }, origin);
		}
		if (spec.nameSensitivity === "hide") {
			return errorResponse("KV_KEY_NAME_HIDDEN", 403, { family: spec.family }, origin);
		}
		if (spec.valueSensitivity === "no-read") {
			return errorResponse("KV_KEY_VALUE_FORBIDDEN", 403, { family: spec.family }, origin);
		}

		let payload: Record<string, unknown>;
		try {
			const offset = Math.max(
				0,
				Number.parseInt(readQuery(request, "contentOffset") ?? "0", 10) || 0,
			);
			const limitRaw = readQuery(request, "contentLimit");
			const limit = limitRaw ? Math.max(0, Number.parseInt(limitRaw, 10) || 0) : null;
			payload = await inspectKeyPayload(env, spec, key, offset, limit === 0 ? null : limit);
		} catch (err) {
			if (err instanceof CacheManagementError && err.code === "NOT_ALLOWED") {
				return errorResponse("FORBIDDEN", 403, { family: spec.family }, origin);
			}
			return errorResponse("INTERNAL_ERROR", 500, { family: spec.family }, origin);
		}
		if (payload.status === "read-failed" || payload.status === "not-found") {
			return jsonNoStoreResponse(payload, origin);
		}
		if (payload.found !== true) {
			return errorResponse("KV_KEY_NOT_FOUND", 404, { key }, origin);
		}
		return jsonNoStoreResponse(payload, origin);
	},
);

export const inspect = getKey;

// ─── POST /api/admin/kv/refresh ───────────────────────────────────
//
// Single dispatcher for every typed `KvRefreshAction`. Body shape:
//   { family: string, action: { kind: "...", forumId?, key?, ... } }
// Action kind MUST match the family's declared `refresh.kind` so the
// front end can't smuggle a different action onto a family.

// Table of refresh actions that take no extra args and just call a
// generation-bump helper. Keeping these out of the main switch caps
// the cognitive complexity of `refresh`.
const SIMPLE_BUMP_ACTIONS: Record<string, { gen: string; run: (env: Env) => Promise<string> }> = {
	"bump-forum-tree": { gen: "forum:tree:gen", run: bumpForumTreeGen },
	"bump-thread-list-all": { gen: "thread:list:gen:all", run: bumpThreadListGenAll },
	"bump-digest": { gen: "digest:gen", run: bumpDigestGen },
};

export const refresh = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await parseBody(request);
		if (!body) return errorResponse("INVALID_BODY", 400, undefined, origin);
		const familyParam = typeof body.family === "string" ? body.family : null;
		if (!familyParam) return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		const spec = findFamily(familyParam);
		if (!spec) return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
		const action = body.action as { kind?: string } | undefined;
		const kind = action?.kind;
		if (!kind || kind !== spec.refresh.kind) {
			return errorResponse(
				"KV_ACTION_MISMATCH",
				400,
				{ family: spec.family, expected: spec.refresh.kind, got: kind ?? null },
				origin,
			);
		}
		const actor = resolveActor(request, env);

		// Simple no-arg bump actions are dispatched via a shared table to
		// keep the switch below under the lint complexity budget.
		const simpleBump = SIMPLE_BUMP_ACTIONS[spec.refresh.kind];
		if (simpleBump) {
			return finishGroupBump(
				env,
				actor,
				spec,
				simpleBump.gen,
				await simpleBump.run(env),
				origin,
				ctx,
			);
		}

		switch (spec.refresh.kind) {
			case "bump-thread-list-forum":
				return refreshBumpThreadListForum(env, actor, spec, action, origin, ctx);
			case "bump-thread-meta":
			case "bump-post-list":
				return refreshBumpThreadScoped(env, actor, spec, action, origin, ctx);
			case "delete-literal":
				return refreshDeleteLiteral(env, actor, spec, action, origin, ctx);
			case "delete-user-mini":
				return refreshDeleteUserMini(env, actor, spec, action, origin, ctx);
			case "none":
				return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
		}
		return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
	},
);

async function finishGroupBump(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: { family: string },
	gen: string,
	newGen: string,
	origin: string | undefined,
	_ctx: ExecutionContext | undefined,
	extra: Record<string, unknown> = {},
): Promise<Response> {
	if (isUnavailableGen(newGen)) {
		await writeAdminLog(env, actor, {
			action: "kv.bump_gen",
			targetType: "kv_family",
			targetId:
				typeof extra.forumId === "number"
					? extra.forumId
					: typeof extra.threadId === "number"
						? extra.threadId
						: null,
			details: { family: spec.family, gen, newGen, outcome: "failed" },
		});
		return jsonNoStoreResponse(
			{
				ok: false,
				family: spec.family,
				...extra,
				newGen,
				outcome: "failed",
				rebuilt: false,
				observedAt: Date.now(),
				error: {
					code: "KV_INVALIDATE_UNAVAILABLE",
					message: "generation bump was not confirmed",
				},
				consistencyNote: "written-not-globally-visible",
			},
			origin,
		);
	}
	await writeAdminLog(env, actor, {
		action: "kv.bump_gen",
		targetType: "kv_family",
		targetId:
			typeof extra.forumId === "number"
				? extra.forumId
				: typeof extra.threadId === "number"
					? extra.threadId
					: null,
		details: { family: spec.family, gen, newGen },
	});
	return jsonNoStoreResponse(
		{
			ok: true,
			family: spec.family,
			...extra,
			newGen,
			outcome: "invalidated",
			rebuilt: false,
			observedAt: Date.now(),
			consistencyNote: "written-not-globally-visible",
		},
		origin,
	);
}

async function refreshBumpThreadListForum(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const forumId = Number((action as { forumId?: unknown }).forumId);
	if (!Number.isInteger(forumId) || forumId <= 0) {
		return errorResponse("MISSING_FORUM_ID", 400, undefined, origin);
	}
	const newGen = await bumpThreadListGen(env, forumId);
	return finishGroupBump(env, actor, spec, `thread:list:gen:${forumId}`, newGen, origin, ctx, {
		forumId,
	});
}

async function refreshBumpThreadScoped(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const threadId = Number((action as { threadId?: unknown }).threadId);
	if (!Number.isInteger(threadId) || threadId <= 0) {
		return errorResponse("MISSING_THREAD_ID", 400, undefined, origin);
	}
	const isMeta = spec.refresh.kind === "bump-thread-meta";
	const newGen = await (isMeta ? bumpThreadMetaGen : bumpPostListGen)(env, threadId);
	return finishGroupBump(
		env,
		actor,
		spec,
		`${isMeta ? "thread:meta" : "post:list"}:gen:${threadId}`,
		newGen,
		origin,
		ctx,
		{ threadId },
	);
}

async function refreshDeleteLiteral(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	_ctx: ExecutionContext | undefined,
): Promise<Response> {
	const key = (action as { key?: unknown }).key;
	if (typeof key !== "string" || key.length === 0) {
		return errorResponse("MISSING_KEY", 400, undefined, origin);
	}
	const targetSpec = resolveFamilyForKey(key);
	if (!targetSpec || targetSpec.family !== spec.family) {
		return errorResponse("KV_KEY_FAMILY_MISMATCH", 400, { family: spec.family, key }, origin);
	}
	if (targetSpec.refresh.kind !== "delete-literal") {
		return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
	}
	await env.KV.delete(key);
	const masked = await maskKeyName(key, targetSpec);
	await writeAdminLog(env, actor, {
		action: "kv.delete_key",
		targetType: "kv_key",
		targetId: null,
		details: { family: spec.family, maskedKey: masked },
	});
	return jsonNoStoreResponse(
		{
			ok: true,
			family: spec.family,
			deleted: 1,
			outcome: "deleted",
			rebuilt: false,
			observedAt: Date.now(),
			consistencyNote: "delete-sent-not-globally-visible",
		},
		origin,
	);
}

async function refreshDeleteUserMini(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	_ctx: ExecutionContext | undefined,
): Promise<Response> {
	const userId = Number((action as { userId?: unknown }).userId);
	if (!Number.isInteger(userId) || userId <= 0) {
		return errorResponse("MISSING_USER_ID", 400, undefined, origin);
	}
	// `spec.family === "user:mini:v1"` (live). Route to the live v1
	// invalidator (`lib/user-cache.ts`) which writes the literal
	// `user:mini:<id>` key — NOT the planned-v2 `user:mini:v2:<id>`
	// helper in `lib/cache/invalidate.ts:deleteUserMini` (that one is
	// for the future v2 family and would silently miss the live row).
	await invalidateUserCache(env, userId, { strict: true });
	await writeAdminLog(env, actor, {
		action: "kv.delete_key",
		targetType: "kv_key",
		targetId: userId,
		details: { family: spec.family },
	});
	return jsonNoStoreResponse(
		{
			ok: true,
			family: spec.family,
			userId,
			deleted: 1,
			outcome: "deleted",
			rebuilt: false,
			observedAt: Date.now(),
			consistencyNote: "delete-sent-not-globally-visible",
		},
		origin,
	);
}

// ─── GET /api/admin/kv/metrics ────────────────────────────────────
//
// Historical hourly op-dimensioned series. Continuous collection is retired.
// Reads legacy observations from `kv_cache_metrics_hour`; collection has stopped.
//
// Query params:
//   - `family` (optional): restrict to one registry family. When omitted
//     the response carries all rows in the window, grouped by family.
//   - `minutes`: window size in minutes (default 1440, min 60, max 10080 = 7d).
//
// Response shape:
//   { family: string | null, minutes: number,
//     series: [{ family, tsMinute, op, count }, ...] }
//
// `op` includes cache verbs plus optional D1 observation
// (`d1-query | d1-rows-read | d1-rows-written | d1-duration-ms`) under
// families `application:d1` and `admin:d1`. No extra SQL: those rows
// remain in `kv_cache_metrics_hour` from the retired observation collector.
// Hit-rate must ignore admin:* and D1 families.

export const metrics = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const { family, minutes } = parseMonitorMetricsQuery({
			family: readQuery(request, "family"),
			minutes: readQuery(request, "minutes"),
		});
		try {
			const enrolled = findFamily("monitor:metrics:recent")?.loader === "monitor";
			const data = enrolled
				? await getMonitorMetrics(env, ctx, family, minutes)
				: await loadMonitorMetrics(env, family, minutes);
			return jsonNoStoreResponse(data, origin);
		} catch (err) {
			console.warn("[admin/kv] metrics query failed", err);
			return jsonNoStoreResponse(
				{
					family,
					minutes,
					series: [],
					note: "metrics table unavailable",
					observedAt: Date.now(),
					source: "application:kv_cache_metrics_hour",
					intervalMinutes: 60,
					sampling: "best-effort",
					truncated: false,
					coverage: "partial",
				},
				origin,
			);
		}
	},
);

// ─── POST /api/admin/kv/delete ────────────────────────────────────
// Per-entry delete. Distinct from group gen bump (`refresh`). Does not
// rebuild, does not touch D1 business rows, refuses runtime-state keys.

export const deleteEntry = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await parseBody(request);
		if (!body) return errorResponse("INVALID_BODY", 400, undefined, origin);
		const familyParam = typeof body.family === "string" ? body.family : null;
		const key = typeof body.key === "string" ? body.key : null;
		if (!familyParam) return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		if (!key) return errorResponse("MISSING_KEY", 400, undefined, origin);
		const spec = findFamily(familyParam);
		if (!spec) return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
		const targetSpec = resolveFamilyForKey(key);
		if (!targetSpec || targetSpec.family !== spec.family) {
			return errorResponse("KV_KEY_FAMILY_MISMATCH", 400, { family: spec.family, key }, origin);
		}
		const actions = familyActions(spec);
		if (!actions.deleteEntry) {
			return jsonNoStoreResponse(
				{
					outcome: "not-allowed",
					deletedKeys: [],
					observedAt: Date.now(),
					error: { code: "KV_ACTION_NOT_ALLOWED", message: actions.restriction ?? "not-allowed" },
					consistencyNote: "delete-sent-not-globally-visible",
				},
				origin,
			);
		}
		const actor = resolveActor(request, env);
		const masked = await maskKeyName(key, spec);
		try {
			await deleteCacheEntry(env, key);
		} catch (err) {
			console.warn("[admin/kv] deleteEntry failed", err);
			const code = err instanceof CacheManagementError ? err.code : "KV_DELETE_FAILED";
			const message =
				err instanceof CacheManagementError ? err.message : "KV delete did not confirm";
			await writeAdminLog(env, actor, {
				action: "kv.delete_key",
				targetType: "kv_key",
				targetId: null,
				details: { family: spec.family, maskedKey: masked, outcome: "failed", code },
			});
			return jsonNoStoreResponse(
				{
					outcome: code === "NOT_ALLOWED" ? "not-allowed" : "failed",
					deletedKeys: [],
					observedAt: Date.now(),
					error: { code, message },
					consistencyNote: "delete-sent-not-globally-visible",
				},
				origin,
			);
		}
		await writeAdminLog(env, actor, {
			action: "kv.delete_key",
			targetType: "kv_key",
			targetId: null,
			details: { family: spec.family, maskedKey: masked, outcome: "deleted" },
		});
		return jsonNoStoreResponse(
			{
				outcome: "deleted",
				deletedKeys: [masked],
				observedAt: Date.now(),
				consistencyNote: "delete-sent-not-globally-visible",
			},
			origin,
		);
	},
);

function rebuildFailure(err: unknown): {
	code: string;
	stage: string;
	message: string;
	outcome: "not-rebuildable" | "partial" | "failed";
} {
	const code = err instanceof CacheManagementError ? err.code : "CACHE_REBUILD_FAILED";
	const stage = err instanceof CacheManagementError ? err.stage : "load";
	const message = err instanceof CacheManagementError ? err.message : "rebuild failed";
	const outcome =
		code === "NOT_REBUILDABLE" || code === "NOT_ALLOWED"
			? "not-rebuildable"
			: code === "WRITE_FAILED"
				? "partial"
				: "failed";
	return { code, stage, message, outcome };
}

// ─── POST /api/admin/kv/rebuild ───────────────────────────────────
// Per-entry rebuild via manage.rebuildCacheEntry. Throws on missing,
// expired, or unsupported descriptors; this handler never treats a
// generation bump as a successful rebuild.

export const rebuild = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await parseBody(request);
		if (!body) return errorResponse("INVALID_BODY", 400, undefined, origin);
		const familyParam = typeof body.family === "string" ? body.family : null;
		const key = typeof body.key === "string" ? body.key : null;
		if (!familyParam) return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		if (!key) return errorResponse("MISSING_KEY", 400, undefined, origin);
		if (body.params !== undefined || body.scope !== undefined) {
			return errorResponse("UNKNOWN_KEYS", 400, { rejected: ["params", "scope"] }, origin);
		}
		const spec = findFamily(familyParam);
		if (!spec) return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
		const targetSpec = resolveFamilyForKey(key);
		if (!targetSpec || targetSpec.family !== spec.family) {
			return errorResponse("KV_KEY_FAMILY_MISMATCH", 400, { family: spec.family, key }, origin);
		}
		if (!canRebuildCacheFamily(spec.family)) {
			return jsonNoStoreResponse(
				{
					outcome: "not-rebuildable",
					stage: "validate",
					observedAt: Date.now(),
					error: {
						code: "KV_ACTION_NOT_ALLOWED",
						message: familyActions(spec).restriction ?? "not-rebuildable",
					},
					consistencyNote: "written-not-globally-visible",
				},
				origin,
			);
		}
		const actor = resolveActor(request, env);
		const masked = await maskKeyName(key, spec);
		try {
			const envelope = await rebuildCacheEntry(env, ctx, key);
			await writeAdminLog(env, actor, {
				action: "kv.rebuild",
				targetType: "kv_key",
				targetId: null,
				details: { family: spec.family, maskedKey: masked, outcome: "rebuilt" },
			});
			return jsonNoStoreResponse(
				{
					outcome: "rebuilt",
					stage: "complete",
					observedAt: Date.now(),
					loadedAt: envelope.loadedAt,
					expiresAt: envelope.expiresAt,
					tier: envelope.tier,
					schemaVersion: envelope.schemaVersion,
					family: envelope.family,
					params: envelope.params,
					scope: envelope.scope,
					value: envelope.data,
					consistencyNote: "written-not-globally-visible",
				},
				origin,
			);
		} catch (err) {
			const { code, stage, message, outcome } = rebuildFailure(err);
			await writeAdminLog(env, actor, {
				action: "kv.rebuild",
				targetType: "kv_key",
				targetId: null,
				details: { family: spec.family, maskedKey: masked, outcome, code, stage },
			});
			return jsonNoStoreResponse(
				{
					outcome,
					stage,
					observedAt: Date.now(),
					error: { code, message },
					consistencyNote: "written-not-globally-visible",
				},
				origin,
			);
		}
	},
);

// ─── GET /api/admin/kv/operations ─────────────────────────────────
// Existing admin_logs rows for kv.* only. Never returns cache bodies.

interface OperationsCursor {
	createdAt: number;
	id: number;
}

interface OperationLogRow {
	id: number;
	admin_id: number;
	admin_name: string;
	action: string;
	target_type: string;
	target_id: number | null;
	details: string;
	created_at: number;
}

function isOperationsCursor(parsed: Partial<OperationsCursor>): boolean {
	return (
		typeof parsed.createdAt === "number" &&
		Number.isSafeInteger(parsed.createdAt) &&
		typeof parsed.id === "number" &&
		Number.isSafeInteger(parsed.id) &&
		parsed.id > 0
	);
}

function operationsUnavailable(origin: string | undefined): Response {
	return jsonNoStoreResponse(
		{
			rows: [],
			note: "operations unavailable",
			cursor: null,
			listComplete: false,
			observedAt: Date.now(),
			source: "application:admin_logs",
		},
		origin,
	);
}

function mapOperationRows(rows: OperationLogRow[]) {
	return rows.map((r) => ({
		id: r.id,
		adminName: r.admin_name,
		action: r.action,
		targetType: r.target_type,
		targetId: r.target_id,
		details: r.details,
		createdAt: r.created_at,
	}));
}

async function queryOperations(
	env: Env,
	limit: number,
	cursor: OperationsCursor | null,
): Promise<
	{ ok: false } | { ok: true; rows: ReturnType<typeof mapOperationRows>; nextCursor: string | null }
> {
	const sql = cursor
		? `SELECT id, admin_id, admin_name, action, target_type, target_id, details, created_at
			 FROM admin_logs
			 WHERE action IN (?, ?, ?, ?)
			   AND (created_at < ? OR (created_at = ? AND id < ?))
			 ORDER BY created_at DESC, id DESC
			 LIMIT ?`
		: `SELECT id, admin_id, admin_name, action, target_type, target_id, details, created_at
			 FROM admin_logs
			 WHERE action IN (?, ?, ?, ?)
			 ORDER BY created_at DESC, id DESC
			 LIMIT ?`;
	const binds = cursor
		? [...KV_AUDIT_ACTIONS, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
		: [...KV_AUDIT_ACTIONS, limit + 1];
	const result = await env.DB.prepare(sql)
		.bind(...binds)
		.all<OperationLogRow>();
	if (!result.success || !Array.isArray(result.results)) return { ok: false };
	const hasMore = result.results.length > limit;
	const page = hasMore ? result.results.slice(0, limit) : result.results;
	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last
			? encodeGenericCursor<OperationsCursor>({ createdAt: last.created_at, id: last.id })
			: null;
	return { ok: true, rows: mapOperationRows(page), nextCursor };
}

export const operations = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const limit = Math.min(
			Math.max(Number.parseInt(readQuery(request, "limit") ?? "50", 10) || 50, 1),
			100,
		);
		const token = readQuery(request, "cursor");
		let cursor: OperationsCursor | null = null;
		if (token) {
			cursor = decodeGenericCursor<OperationsCursor>(token, isOperationsCursor);
			if (!cursor) return errorResponse("INVALID_CURSOR", 400, undefined, origin);
		}
		try {
			const page = await queryOperations(env, limit, cursor);
			if (!page.ok) return operationsUnavailable(origin);
			return jsonNoStoreResponse(
				{
					rows: page.rows,
					cursor: page.nextCursor,
					listComplete: page.nextCursor === null,
					observedAt: Date.now(),
					source: "application:admin_logs",
				},
				origin,
			);
		} catch (err) {
			console.warn("[admin/kv] operations query failed", err);
			return operationsUnavailable(origin);
		}
	},
);
