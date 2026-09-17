// Admin stats handler — #61 GET /api/admin/stats

import { withEntityAuth } from "../../lib/adminHelpers";
import { getAdminReport } from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";

const statsConfig: EntityConfig = {
	table: "",
	entityName: "STATS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

async function getStats(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	return jsonNoStoreResponse(
		await getAdminReport(env, ctx, {
			family: "admin:analytics",
			scope: "admin",
			params: { resource: "stats", operation: "totals" },
		}),
		origin,
	);
}

export const handleStats = withEntityAuth(statsConfig, getStats);
