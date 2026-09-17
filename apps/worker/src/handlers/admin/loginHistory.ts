// Admin login-history endpoints (P4). KPI and masked list are SHORT display
// snapshots. Raw IP reveal is intentionally absent here and must stay uncached.

import { withEntityAuth } from "../../lib/adminHelpers";
import {
	getAdminReport,
	LIST_PAGE_SIZE_DEFAULT,
	LIST_PAGE_SIZE_MAX,
	loadLoginsKpi,
	localTodayStart,
	maskIp,
	shanghaiDateLocal,
} from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";

const loginHistoryConfig: EntityConfig = {
	table: "",
	entityName: "LOGIN_HISTORY",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

function listFilters(url: URL) {
	const okFilter = url.searchParams.get("ok");
	const kindFilter = url.searchParams.get("kind");
	const errorCodeFilter = url.searchParams.get("errorCode");
	const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
	const rawLimit = Number.parseInt(
		url.searchParams.get("limit") ?? String(LIST_PAGE_SIZE_DEFAULT),
		10,
	);
	const limit = Math.min(
		LIST_PAGE_SIZE_MAX,
		Math.max(1, Number.isFinite(rawLimit) ? rawLimit : LIST_PAGE_SIZE_DEFAULT),
	);
	return {
		ok: okFilter === "0" || okFilter === "1" ? Number.parseInt(okFilter, 10) : null,
		kind: kindFilter === "login" || kindFilter === "register" ? kindFilter : null,
		errorCode:
			errorCodeFilter && errorCodeFilter.length > 0 && errorCodeFilter.length <= 64
				? errorCodeFilter
				: null,
		page,
		limit,
	};
}

async function kpiHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "logins",
				operation: "kpi",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
			},
		}),
		origin,
	);
}

async function listHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const filters = listFilters(new URL(request.url));
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:display",
			scope: "admin",
			params: {
				resource: "logins",
				operation: "list",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
				...filters,
			},
		}),
		origin,
	);
}

export const getTodayLoginsKpi = withEntityAuth(loginHistoryConfig, kpiHandler);
export const getTodayLoginsList = withEntityAuth(loginHistoryConfig, listHandler);

export const _internal = {
	localTodayStart,
	maskIp,
	loadKpi: loadLoginsKpi,
	loginHistoryConfig,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_DEFAULT,
};
