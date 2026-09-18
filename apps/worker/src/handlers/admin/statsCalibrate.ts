import { invalidateStatisticsReports } from "../../lib/cache/invalidate";
// Admin stats calibration handler — GET/POST /api/admin/stats/calibrate
// Allows admin to view stored counter values, run COUNT(*) queries,
// and apply offsets or real values to the stored counters.
//
// SEMANTIC NOTE: These counters represent HISTORICAL CUMULATIVE totals.
// The "real" values from COUNT(*) are full table counts (not filtered by
// visibility/status). This matches the counter semantics — "total ever
// created" rather than "currently visible".

import { withEntityAuth } from "../../lib/adminHelpers";
import { getPublicStats } from "../../lib/cache/public-stats-read";
import { cacheDelete } from "../../lib/cache/wrap";
import type { EntityConfig } from "../../lib/crud";
import { confirmedBatch } from "../../lib/d1-write";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { shanghaiDateLocal } from "../../lib/shanghaiTime";
import { errorResponse } from "../../middleware/error";

// KV key for public stats cache
const PUBLIC_STATS_CACHE_KEY = "public-stats";

// ─── Types ───────────────────────────────────────────────────

interface CounterRow {
	key: string;
	stored: number;
	real: number | null; // null until "Run Statistics" is clicked
}

interface CalibrateGetResponse {
	counters: CounterRow[];
	todayPosts: number;
	todayDate: string;
}

interface CalibratePostResponse {
	success: boolean;
	counters?: CounterRow[];
}

// ─── Entity config ───────────────────────────────────────────

const calibrateConfig: EntityConfig = {
	table: "",
	entityName: "STATS_CALIBRATE",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

// ─── Counter keys ────────────────────────────────────────────

const COUNTER_KEYS = [
	"stats.total_threads",
	"stats.total_posts",
	"stats.total_members",
	"stats.yesterday_posts",
] as const;

// ─── Action handlers ─────────────────────────────────────────

async function loadRealCounts(env: Env): Promise<Map<string, number>> {
	const tables = [
		["stats.total_threads", "threads"],
		["stats.total_posts", "posts"],
		["stats.total_members", "users"],
	] as const;
	return new Map(
		await Promise.all(
			tables.map(async ([key, table]) => {
				const row = await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).first<{
					cnt: number;
				}>();
				if (!row || !Number.isSafeInteger(row.cnt) || row.cnt < 0) {
					throw new Error("Statistics count could not be loaded");
				}
				return [key, row.cnt] as const;
			}),
		),
	);
}

async function writeCounters(env: Env, statements: D1PreparedStatement[]): Promise<void> {
	const written = await confirmedBatch(env, statements);
	if (written.some((row) => row.meta?.changes !== 1)) {
		throw new Error("Statistics writes were not confirmed");
	}
	await Promise.all([
		cacheDelete(env, PUBLIC_STATS_CACHE_KEY, "public-stats"),
		invalidateStatisticsReports(env),
	]);
}

async function handleRunStats(env: Env, origin?: string): Promise<Response> {
	const real = await loadRealCounts(env);

	const settingsResult = await env.DB.prepare(
		`SELECT key, value FROM settings WHERE key IN (${COUNTER_KEYS.map(() => "?").join(", ")})`,
	)
		.bind(...COUNTER_KEYS)
		.all<{ key: string; value: string }>();
	if (!settingsResult.success) throw new Error("Statistics counters could not be loaded");

	const storedMap = new Map<string, number>();
	for (const row of settingsResult.results) {
		storedMap.set(row.key, Number.parseInt(row.value, 10) || 0);
	}

	const counters: CounterRow[] = COUNTER_KEYS.map((key) => ({
		key,
		stored: storedMap.get(key) ?? 0,
		real: real.get(key) ?? null,
	}));

	return jsonNoStoreResponse({ success: true, counters } satisfies CalibratePostResponse, origin);
}

async function handleApplyReal(env: Env, origin?: string): Promise<Response> {
	const real = await loadRealCounts(env);
	const now = Math.floor(Date.now() / 1000);
	await writeCounters(
		env,
		[...real].map(([key, count]) =>
			env.DB.prepare(
				`INSERT INTO settings (key, value, type, updated_at) VALUES (?, ?, 'number', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at`,
			).bind(key, String(count), now),
		),
	);

	return jsonNoStoreResponse({ success: true } satisfies CalibratePostResponse, origin);
}

async function handleApplyOffsets(env: Env, offsets: unknown, origin?: string): Promise<Response> {
	if (!offsets || typeof offsets !== "object" || Array.isArray(offsets)) {
		return errorResponse("INVALID_BODY", 400, { message: "offsets required" }, origin);
	}

	const now = Math.floor(Date.now() / 1000);
	const updates: D1PreparedStatement[] = [];

	for (const [key, offset] of Object.entries(offsets)) {
		if (
			!COUNTER_KEYS.includes(key as (typeof COUNTER_KEYS)[number]) ||
			typeof offset !== "number" ||
			!Number.isSafeInteger(offset)
		) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "Unknown counter or invalid integer offset", key },
				origin,
			);
		}
		if (offset === 0) continue;

		updates.push(
			env.DB.prepare(
				`INSERT INTO settings (key, value, type, updated_at) VALUES (?, ?, 'number', ?)
				 ON CONFLICT(key) DO UPDATE SET value = CAST(settings.value AS INTEGER) + CAST(excluded.value AS INTEGER), type = excluded.type, updated_at = excluded.updated_at`,
			).bind(key, String(offset), now),
		);
	}

	if (updates.length > 0) {
		await writeCounters(env, updates);
	}

	return jsonNoStoreResponse({ success: true } satisfies CalibratePostResponse, origin);
}

// ─── Main handlers ───────────────────────────────────────────

async function handleGet(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	const settingsResult = await env.DB.prepare(
		`SELECT key, value FROM settings WHERE key IN (${COUNTER_KEYS.map(() => "?").join(", ")})`,
	)
		.bind(...COUNTER_KEYS)
		.all<{ key: string; value: string }>();
	if (!settingsResult.success) throw new Error("Statistics counters could not be loaded");

	const storedMap = new Map<string, number>();
	for (const row of settingsResult.results) {
		storedMap.set(row.key, Number.parseInt(row.value, 10) || 0);
	}

	const counters: CounterRow[] = COUNTER_KEYS.map((key) => ({
		key,
		stored: storedMap.get(key) ?? 0,
		real: null,
	}));

	const snapshot = await getPublicStats(env, undefined, "admin");

	const response: CalibrateGetResponse = {
		counters,
		todayPosts: snapshot.todayPosts,
		todayDate: shanghaiDateLocal(),
	};

	return jsonNoStoreResponse(response, origin);
}

async function handlePost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}
	const input = body as Record<string, unknown>;
	switch (input.action) {
		case "run_stats":
			return handleRunStats(env, origin);
		case "apply_real":
			return handleApplyReal(env, origin);
		case "apply_offsets":
			return handleApplyOffsets(env, input.offsets, origin);
		default:
			return errorResponse("INVALID_BODY", 400, { message: "Unknown action" }, origin);
	}
}

// ─── Exports ─────────────────────────────────────────────────

export const handleCalibrateGet = withEntityAuth(calibrateConfig, handleGet);
export const handleCalibratePost = withEntityAuth(calibrateConfig, handlePost);
