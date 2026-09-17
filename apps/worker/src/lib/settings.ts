import { dataCacheKey } from "./cache/keys";
// apps/worker/src/lib/settings.ts
// Settings KV cache helper — read-through cache with write-invalidation
// Single KV key "settings:all" holds all settings as JSON (< 2KB)
// Conforms to docs/20-worker-kv-reference.md: unified envelope caching with LONG tier.

import { cacheDelete, cacheGetOrSet } from "./cache/wrap";
import type { Env } from "./env";

// ─── Types ────────────────────────────────────────────────────

export type SettingsMap = Record<string, string | number | boolean | object>;

export interface SettingEntry {
	value: string;
	type: "string" | "number" | "boolean" | "json";
	updatedAt: number;
}

export type SettingsDetailMap = Record<string, SettingEntry>;

// ─── Constants ────────────────────────────────────────────────

export const SETTINGS_KEY = "settings:all";
export const SETTINGS_FAMILY = "settings:all";
export const SETTINGS_TIER = "LONG" as const;

// ─── Internal helpers ─────────────────────────────────────────

interface SettingsRow {
	key: string;
	value: string;
	type: "string" | "number" | "boolean" | "json";
	updated_at: number;
}

/** Parse a raw string value according to its declared type */
function parseValue(value: string, type: string): string | number | boolean | object {
	switch (type) {
		case "number": {
			const n = Number(value);
			return Number.isNaN(n) ? 0 : n;
		}
		case "boolean":
			return value === "true" || value === "1";
		case "json":
			try {
				return JSON.parse(value) as object;
			} catch {
				return {};
			}
		default:
			return value;
	}
}

/** Fetch all settings rows from D1 (authoritative DB read) */
export async function fetchAllSettingsFromDb(env: Env): Promise<SettingsMap> {
	const result = await env.DB.prepare("SELECT key, value, type FROM settings").all<{
		key: string;
		value: string;
		type: string;
	}>();
	if (!result.success) throw new Error("Settings could not be loaded");
	const map: SettingsMap = {};
	for (const row of result.results ?? []) {
		map[row.key] = parseValue(row.value, row.type);
	}
	return map;
}

export function isValidSettingsMap(value: unknown): value is SettingsMap {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Exported functions ───────────────────────────────────────

/**
 * Get all settings as a typed map (number/boolean/json values already parsed).
 * Uses core cacheGetOrSet with LONG tier (86400s), envelope schema, and parameters.
 */
export async function getSettings(env: Env, ctx?: ExecutionContext): Promise<SettingsMap> {
	return cacheGetOrSet<SettingsMap>(env, ctx, SETTINGS_KEY, () => fetchAllSettingsFromDb(env), {
		family: SETTINGS_FAMILY,
		tier: SETTINGS_TIER,
		params: {},
		scope: "public",
		validator: isValidSettingsMap,
	});
}

/**
 * Get a single setting value with a typed default.
 * Display reads use the cached getSettings map.
 */
export async function getSetting<T extends string | number | boolean | object>(
	env: Env,
	key: string,
	defaultValue: T,
	ctx?: ExecutionContext,
): Promise<T> {
	const all = await getSettings(env, ctx);
	if (key in all) {
		return all[key] as T;
	}
	return defaultValue;
}

/**
 * Authoritative setting reader that bypasses KV cache.
 * Use for security, permission gate, write-validation or token validation.
 */
export async function getSettingFresh<T extends string | number | boolean | object>(
	env: Env,
	key: string,
	defaultValue: T,
): Promise<T> {
	const row = await env.DB.prepare("SELECT value, type FROM settings WHERE key = ?")
		.bind(key)
		.first<{ value: string; type: string }>();
	if (!row) return defaultValue;
	return parseValue(row.value, row.type) as T;
}

/** Batch the current policy keys needed by one authorization decision. */
export async function getSettingsFresh(env: Env, keys: readonly string[]): Promise<SettingsMap> {
	if (!keys.length) return {};
	const rows = await env.DB.prepare(
		`SELECT key, value, type FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`,
	)
		.bind(...keys)
		.all<{ key: string; value: string; type: string }>();
	if (!rows.success) throw new Error("Current settings could not be loaded");
	return Object.fromEntries(rows.results.map((row) => [row.key, parseValue(row.value, row.type)]));
}

/**
 * Get all settings with full metadata (value + type + updatedAt).
 * Always reads from D1 (admin UI needs fresh data).
 */
export async function getSettingsDetailed(env: Env): Promise<SettingsDetailMap> {
	const result = await env.DB.prepare(
		"SELECT key, value, type, updated_at FROM settings",
	).all<SettingsRow>();
	if (!result.success) throw new Error("Settings could not be loaded");
	const map: SettingsDetailMap = {};
	for (const row of result.results ?? []) {
		map[row.key] = {
			value: row.value,
			type: row.type,
			updatedAt: row.updated_at,
		};
	}
	return map;
}

/**
 * Batch update settings and invalidate KV cache via core cacheDelete.
 * Only UPDATE existing keys — INSERT of new keys is not allowed.
 * Uses D1 batch() for atomic execution.
 */
export async function upsertSettings(env: Env, entries: Record<string, string>): Promise<void> {
	const keys = Object.keys(entries);
	if (keys.length === 0) return;

	const now = Math.floor(Date.now() / 1000);
	const stmts = keys.map((key) =>
		env.DB.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").bind(
			entries[key],
			now,
			key,
		),
	);

	const written = await env.DB.batch(stmts);
	if (written.length !== stmts.length || written.some((row) => !row.success))
		throw new Error("Settings writes were not confirmed");

	// Invalidate KV cache entry via core cacheDelete
	await Promise.all([
		cacheDelete(env, SETTINGS_KEY, SETTINGS_FAMILY),
		cacheDelete(env, await dataCacheKey("admin:settings", {}, "admin"), "admin:settings"),
	]);
}
