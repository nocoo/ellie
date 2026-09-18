// Admin "today visits" page-view dashboard endpoints (P5).
// Aggregate KPI + list are MEDIUM display snapshots. No IP/UA is stored.

import { withEntityAuth } from "../../lib/adminHelpers";
import type { PathKind } from "../../lib/analytics/types";
import {
	getAdminReport,
	LIST_PAGE_SIZE_DEFAULT,
	LIST_PAGE_SIZE_MAX,
	loadVisitsKpi,
	loadVisitsList,
	PATH_KIND_VALUES,
	resolveLabels,
	shanghaiDateLocal,
} from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

const todayVisitsConfig: EntityConfig = {
	table: "",
	entityName: "TODAY_VISITS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

async function kpiHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "visits",
				operation: "kpi",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
			},
		}),
		origin,
	);
}

async function listHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathKindParam = url.searchParams.get("path_kind");
	if (
		pathKindParam !== null &&
		pathKindParam !== "" &&
		!PATH_KIND_VALUES.has(pathKindParam as PathKind)
	) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Unknown path_kind", allowed: [...PATH_KIND_VALUES] },
			origin,
		);
	}
	const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
	const rawLimit = Number.parseInt(
		url.searchParams.get("limit") ?? String(LIST_PAGE_SIZE_DEFAULT),
		10,
	);
	const limit = Math.min(
		LIST_PAGE_SIZE_MAX,
		Math.max(1, Number.isFinite(rawLimit) ? rawLimit : LIST_PAGE_SIZE_DEFAULT),
	);
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: {
				resource: "visits",
				operation: "list",
				date: shanghaiDateLocal(Math.floor(Date.now() / 1000)),
				pathKind:
					pathKindParam && PATH_KIND_VALUES.has(pathKindParam as PathKind) ? pathKindParam : null,
				page,
				limit,
			},
		}),
		origin,
	);
}

export const getTodayVisitsKpi = withEntityAuth(todayVisitsConfig, kpiHandler);
export const getTodayVisitsList = withEntityAuth(todayVisitsConfig, listHandler);

export const _internal = {
	shanghaiDateLocal,
	loadKpi: loadVisitsKpi,
	loadListPage: loadVisitsList,
	resolveLabels,
	todayVisitsConfig,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_DEFAULT,
	PATH_KIND_VALUES,
};
