// Admin stats calibration handler — GET/POST /api/admin/stats/calibrate
// Allows admin to view stored counter values, run COUNT(*) queries,
// and apply offsets or real values to the stored counters.
//
// SEMANTIC NOTE: These counters represent HISTORICAL CUMULATIVE totals.
// The "real" values from COUNT(*) are full table counts (not filtered by
// visibility/status). This matches the counter semantics — "total ever
// created" rather than "currently visible".

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
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

interface CalibratePostBody {
	action: "run_stats" | "apply_real" | "apply_offsets";
	offsets?: Record<string, number>; // for apply_offsets
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

async function handleRunStats(env: Env, origin?: string): Promise<Response> {
	const [threadsResult, postsResult, usersResult] = await Promise.all([
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads").first<{ cnt: number }>(),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts").first<{ cnt: number }>(),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first<{ cnt: number }>(),
	]);

	const settingsResult = await env.DB.prepare(
		`SELECT key, value FROM settings WHERE key IN (${COUNTER_KEYS.map(() => "?").join(", ")})`,
	)
		.bind(...COUNTER_KEYS)
		.all<{ key: string; value: string }>();

	const storedMap = new Map<string, number>();
	for (const row of settingsResult.results) {
		storedMap.set(row.key, Number.parseInt(row.value, 10) || 0);
	}

	const counters: CounterRow[] = [
		{
			key: "stats.total_threads",
			stored: storedMap.get("stats.total_threads") ?? 0,
			real: threadsResult?.cnt ?? 0,
		},
		{
			key: "stats.total_posts",
			stored: storedMap.get("stats.total_posts") ?? 0,
			real: postsResult?.cnt ?? 0,
		},
		{
			key: "stats.total_members",
			stored: storedMap.get("stats.total_members") ?? 0,
			real: usersResult?.cnt ?? 0,
		},
		{
			key: "stats.yesterday_posts",
			stored: storedMap.get("stats.yesterday_posts") ?? 0,
			real: null,
		},
	];

	return jsonNoStoreResponse({ success: true, counters } satisfies CalibratePostResponse, origin);
}

async function handleApplyReal(env: Env, origin?: string): Promise<Response> {
	const [threadsResult, postsResult, usersResult] = await Promise.all([
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads").first<{ cnt: number }>(),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts").first<{ cnt: number }>(),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first<{ cnt: number }>(),
	]);

	const now = Math.floor(Date.now() / 1000);

	await env.DB.batch([
		env.DB.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").bind(
			String(threadsResult?.cnt ?? 0),
			now,
			"stats.total_threads",
		),
		env.DB.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").bind(
			String(postsResult?.cnt ?? 0),
			now,
			"stats.total_posts",
		),
		env.DB.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").bind(
			String(usersResult?.cnt ?? 0),
			now,
			"stats.total_members",
		),
	]);

	// Invalidate public-stats cache so the new values appear immediately
	await env.KV.delete(PUBLIC_STATS_CACHE_KEY).catch(() => {});

	return jsonNoStoreResponse({ success: true } satisfies CalibratePostResponse, origin);
}

async function handleApplyOffsets(
	env: Env,
	offsets: Record<string, number> | undefined,
	origin?: string,
): Promise<Response> {
	if (!offsets || typeof offsets !== "object") {
		return errorResponse("INVALID_BODY", 400, { message: "offsets required" }, origin);
	}

	const now = Math.floor(Date.now() / 1000);
	const updates: D1PreparedStatement[] = [];

	for (const [key, offset] of Object.entries(offsets)) {
		if (!COUNTER_KEYS.includes(key as (typeof COUNTER_KEYS)[number])) continue;
		if (typeof offset !== "number" || offset === 0) continue;

		updates.push(
			env.DB.prepare(
				"UPDATE settings SET value = CAST(value AS INTEGER) + ?, updated_at = ? WHERE key = ?",
			).bind(offset, now, key),
		);
	}

	if (updates.length > 0) {
		await env.DB.batch(updates);
		// Invalidate public-stats cache so the new values appear immediately
		await env.KV.delete(PUBLIC_STATS_CACHE_KEY).catch(() => {});
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

	const storedMap = new Map<string, number>();
	for (const row of settingsResult.results) {
		storedMap.set(row.key, Number.parseInt(row.value, 10) || 0);
	}

	const counters: CounterRow[] = COUNTER_KEYS.map((key) => ({
		key,
		stored: storedMap.get(key) ?? 0,
		real: null,
	}));

	const [todayPostsStr, todayDate] = await Promise.all([
		env.KV.get("stats:today_posts"),
		env.KV.get("stats:today_date"),
	]);

	const response: CalibrateGetResponse = {
		counters,
		todayPosts: todayPostsStr ? Number.parseInt(todayPostsStr, 10) : 0,
		todayDate: todayDate ?? "",
	};

	return jsonNoStoreResponse(response, origin);
}

async function handlePost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: CalibratePostBody;
	try {
		body = (await request.json()) as CalibratePostBody;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	switch (body.action) {
		case "run_stats":
			return handleRunStats(env, origin);
		case "apply_real":
			return handleApplyReal(env, origin);
		case "apply_offsets":
			return handleApplyOffsets(env, body.offsets, origin);
		default:
			return errorResponse("INVALID_BODY", 400, { message: "Unknown action" }, origin);
	}
}

// ─── Exports ─────────────────────────────────────────────────

export const handleCalibrateGet = withEntityAuth(calibrateConfig, handleGet);
export const handleCalibratePost = withEntityAuth(calibrateConfig, handlePost);
