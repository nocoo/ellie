// Settings KV cache helper — read-through cache with write-invalidation
// Single KV key "settings:all" holds all settings as JSON (< 2KB)

import { recordError, recordHit, recordMiss } from "./cache/metrics";
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

const KV_KEY = "settings:all";
const KV_TTL = 86400; // 24 hours
const METRICS_FAMILY = "settings:all";

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

/** Fetch all settings rows from D1 */
async function fetchAllFromDb(env: Env): Promise<SettingsRow[]> {
	const result = await env.DB.prepare("SELECT key, value, type, updated_at FROM settings").all();
	return (result.results ?? []) as unknown as SettingsRow[];
}

// ─── Exported functions ───────────────────────────────────────

/**
 * Get all settings as a typed map (number/boolean/json values already parsed).
 * Uses KV read-through cache with 24h TTL.
 */
export async function getSettings(env: Env): Promise<SettingsMap> {
	// Try KV cache first
	let cached: string | null = null;
	try {
		cached = await env.KV.get(KV_KEY);
	} catch (err) {
		recordError(METRICS_FAMILY);
		console.warn("[settings] KV read failed", err);
	}
	if (cached) {
		recordHit(METRICS_FAMILY);
		return JSON.parse(cached) as SettingsMap;
	}

	// Cache miss — read from D1
	recordMiss(METRICS_FAMILY);
	const rows = await fetchAllFromDb(env);
	const map: SettingsMap = {};
	for (const row of rows) {
		map[row.key] = parseValue(row.value, row.type);
	}

	// Backfill KV cache
	try {
		await env.KV.put(KV_KEY, JSON.stringify(map), { expirationTtl: KV_TTL });
	} catch (err) {
		recordError(METRICS_FAMILY);
		console.warn("[settings] KV write-back failed", err);
	}

	return map;
}

/**
 * Get a single setting value with a typed default.
 */
export async function getSetting<T extends string | number | boolean | object>(
	env: Env,
	key: string,
	defaultValue: T,
): Promise<T> {
	const all = await getSettings(env);
	if (key in all) {
		return all[key] as T;
	}
	return defaultValue;
}

/**
 * Get all settings with full metadata (value + type + updatedAt).
 * Always reads from D1 (admin UI needs fresh data).
 */
export async function getSettingsDetailed(env: Env): Promise<SettingsDetailMap> {
	const rows = await fetchAllFromDb(env);
	const map: SettingsDetailMap = {};
	for (const row of rows) {
		map[row.key] = {
			value: row.value,
			type: row.type,
			updatedAt: row.updated_at,
		};
	}
	return map;
}

/**
 * Batch update settings and invalidate KV cache.
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

	await env.DB.batch(stmts);

	// Invalidate KV cache immediately
	await env.KV.delete(KV_KEY);
}
