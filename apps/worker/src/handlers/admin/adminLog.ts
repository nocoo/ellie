// Admin audit log handlers — §7 Audit Logs
// Uses CRUD framework for getById.
// Custom handlers for list (action/admin/target filters).
// Admin logs are read-only — no create/update/delete from API (created internally).

import { withEntityAuth } from "../../lib/adminHelpers";
import { getAdminReport } from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { paginatedNoStoreResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Column list ──────────────────────────────────────────────────

const ADMIN_LOG_COLUMNS = `
	id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at
`
	.replace(/\s+/g, " ")
	.trim();

// ─── Mapper ───────────────────────────────────────────────────────

function toAdminLog(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		adminId: row.admin_id as number,
		adminName: row.admin_name as string,
		action: row.action as string,
		targetType: row.target_type as string,
		targetId: row.target_id as number | null,
		details: row.details as string,
		ip: row.ip as string,
		createdAt: row.created_at as number,
	};
}

// ─── Entity Config ────────────────────────────────────────────────

const adminLogConfig: EntityConfig = {
	table: "admin_logs",
	entityName: "ADMIN_LOG",
	auth: "admin",
	columns: ADMIN_LOG_COLUMNS,
	mapper: toAdminLog,
	notFoundCode: "ADMIN_LOG_NOT_FOUND",

	filters: [
		{ param: "adminId", column: "admin_id", type: "exact" },
		{ param: "action", column: "action", type: "exact" },
		{ param: "targetType", column: "target_type", type: "exact" },
		{ param: "targetId", column: "target_id", type: "exact" },
	],
	listSort: "created_at DESC",

	// Admin logs are read-only from API
	canDelete: false,
	batchDelete: false,
};

// ─── GET /api/admin/admin-logs ────────────────────────────────────
// Custom list handler: supports adminId, action, targetType, targetId filters.

export const list = withEntityAuth(
	adminLogConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
			100,
		);
		if (page < 1 || Number.isNaN(page)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
		}
		const adminId = Number.parseInt(url.searchParams.get("adminId") ?? "", 10);
		const targetId = Number.parseInt(url.searchParams.get("targetId") ?? "", 10);
		const startDate = Number.parseInt(url.searchParams.get("startDate") ?? "", 10);
		const endDate = Number.parseInt(url.searchParams.get("endDate") ?? "", 10);
		const action = url.searchParams.get("action");
		const targetType = url.searchParams.get("targetType");
		if ((action && action.length > 128) || (targetType && targetType.length > 64)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid filter" }, origin);
		}
		const data = await getAdminReport<{
			items: unknown[];
			total: number;
			page: number;
			limit: number;
		}>(env, ctx, {
			family: "admin:display",
			scope: "admin",
			params: {
				resource: "admin-logs",
				operation: "list",
				adminId: Number.isSafeInteger(adminId) && adminId > 0 ? adminId : null,
				action: action || null,
				targetType: targetType || null,
				targetId: Number.isSafeInteger(targetId) && targetId > 0 ? targetId : null,
				startDate: Number.isSafeInteger(startDate) && startDate >= 0 ? startDate : null,
				endDate: Number.isSafeInteger(endDate) && endDate >= 0 ? endDate : null,
				page,
				limit,
			},
		});
		return paginatedNoStoreResponse(data.items, data.total, data.page, data.limit, origin);
	},
);

// ─── GET /api/admin/admin-logs/:id ───────────────────────────────

export const getById = withEntityAuth(adminLogConfig, createGetByIdHandler(adminLogConfig));
