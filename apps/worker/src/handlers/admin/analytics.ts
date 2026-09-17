// Admin analytics handlers — query-only dashboard endpoints (P2).
// Display reads go through admin-report-read. Writes never use this module.

import { withEntityAuth } from "../../lib/adminHelpers";
import {
	ALLOWED_METRICS,
	ALLOWED_RANGES,
	dayLocalToIso,
	FORUM_DIST_LIMIT,
	fillDaily,
	fillDailyByIso,
	getAdminReport,
	localTodayIso,
	localTodayStart,
	shanghaiDateLocal,
} from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

const analyticsConfig: EntityConfig = {
	table: "",
	entityName: "ANALYTICS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

function parseRange(url: URL): (typeof ALLOWED_RANGES)[number] | null {
	const raw = url.searchParams.get("range") ?? "7d";
	return (ALLOWED_RANGES as readonly string[]).includes(raw)
		? (raw as (typeof ALLOWED_RANGES)[number])
		: null;
}
function parseMetric(url: URL): (typeof ALLOWED_METRICS)[number] | null {
	const raw = url.searchParams.get("metric") ?? "users";
	return (ALLOWED_METRICS as readonly string[]).includes(raw)
		? (raw as (typeof ALLOWED_METRICS)[number])
		: null;
}

async function overviewHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const date = shanghaiDateLocal(Math.floor(Date.now() / 1000));
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:display",
			scope: "admin",
			params: { resource: "analytics", operation: "overview", date },
		}),
		origin,
	);
}

async function trendHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const metric = parseMetric(url);
	const range = parseRange(url);
	if (!metric)
		return errorResponse("INVALID_METRIC", 400, { allowed: [...ALLOWED_METRICS] }, origin);
	if (!range) return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "trend",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
				metric,
				range,
			},
		}),
		origin,
	);
}

async function forumDistHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const range = parseRange(new URL(request.url));
	if (!range) return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "forum-dist",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
				range,
			},
		}),
		origin,
	);
}

async function checkinHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const range = parseRange(new URL(request.url));
	if (!range) return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "checkin-trend",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
				range,
			},
		}),
		origin,
	);
}

export const getOverview = withEntityAuth(analyticsConfig, overviewHandler);
export const getTrend = withEntityAuth(analyticsConfig, trendHandler);
export const getForumDist = withEntityAuth(analyticsConfig, forumDistHandler);
export const getCheckinTrend = withEntityAuth(analyticsConfig, checkinHandler);

export const _internal = {
	localTodayStart,
	localTodayIso,
	dayLocalToIso,
	fillDaily,
	fillDailyByIso,
	loadOverview: (env: Env, nowSec: number) =>
		getAdminReport(env, undefined, {
			family: "admin:display",
			scope: "admin",
			params: { resource: "analytics", operation: "overview", date: shanghaiDateLocal(nowSec) },
		}),
	loadTrend: (
		env: Env,
		nowSec: number,
		metric: (typeof ALLOWED_METRICS)[number],
		range: (typeof ALLOWED_RANGES)[number],
	) =>
		getAdminReport(env, undefined, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "trend",
				date: shanghaiDateLocal(nowSec),
				metric,
				range,
			},
		}),
	loadForumDist: (env: Env, nowSec: number, range: (typeof ALLOWED_RANGES)[number]) =>
		getAdminReport(env, undefined, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "forum-dist",
				date: shanghaiDateLocal(nowSec),
				range,
			},
		}),
	loadCheckinTrend: (env: Env, nowSec: number, range: (typeof ALLOWED_RANGES)[number]) =>
		getAdminReport(env, undefined, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "analytics",
				operation: "checkin-trend",
				date: shanghaiDateLocal(nowSec),
				range,
			},
		}),
	ALLOWED_METRICS,
	ALLOWED_RANGES,
	FORUM_DIST_LIMIT,
};
