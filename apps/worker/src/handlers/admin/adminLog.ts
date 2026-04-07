// Admin audit log handlers — §7 Audit Logs
// Uses CRUD framework for getById.
// Custom handlers for list (action/admin/target filters).
// Admin logs are read-only — no create/update/delete from API (created internally).

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { paginatedResponse } from "../../lib/response";

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
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);

		const conditions: string[] = [];
		const params: unknown[] = [];

		// Filter: adminId
		const adminIdFilter = url.searchParams.get("adminId");
		if (adminIdFilter) {
			const adminId = Number.parseInt(adminIdFilter, 10);
			if (!Number.isNaN(adminId)) {
				conditions.push("admin_id = ?");
				params.push(adminId);
			}
		}

		// Filter: action
		const actionFilter = url.searchParams.get("action");
		if (actionFilter) {
			conditions.push("action = ?");
			params.push(actionFilter);
		}

		// Filter: targetType
		const targetTypeFilter = url.searchParams.get("targetType");
		if (targetTypeFilter) {
			conditions.push("target_type = ?");
			params.push(targetTypeFilter);
		}

		// Filter: targetId
		const targetIdFilter = url.searchParams.get("targetId");
		if (targetIdFilter) {
			const targetId = Number.parseInt(targetIdFilter, 10);
			if (!Number.isNaN(targetId)) {
				conditions.push("target_id = ?");
				params.push(targetId);
			}
		}

		// Filter: date range (startDate, endDate as Unix timestamps)
		const startDateFilter = url.searchParams.get("startDate");
		if (startDateFilter) {
			const startDate = Number.parseInt(startDateFilter, 10);
			if (!Number.isNaN(startDate)) {
				conditions.push("created_at >= ?");
				params.push(startDate);
			}
		}

		const endDateFilter = url.searchParams.get("endDate");
		if (endDateFilter) {
			const endDate = Number.parseInt(endDateFilter, 10);
			if (!Number.isNaN(endDate)) {
				conditions.push("created_at <= ?");
				params.push(endDate);
			}
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		// Pagination
		const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
			100,
		);
		if (page < 1 || Number.isNaN(page)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
		}

		const countResult = await env.DB.prepare(
			`SELECT COUNT(*) as total FROM admin_logs ${whereClause}`,
		)
			.bind(...params)
			.first<{ total: number }>();

		const result = await env.DB.prepare(
			`SELECT ${ADMIN_LOG_COLUMNS} FROM admin_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...params, limit, (page - 1) * limit)
			.all();

		return paginatedResponse(
			result.results.map((r) => toAdminLog(r as Record<string, unknown>)),
			countResult?.total ?? 0,
			page,
			limit,
			origin,
		);
	},
);

// ─── GET /api/admin/admin-logs/:id ───────────────────────────────

export const getById = withEntityAuth(adminLogConfig, createGetByIdHandler(adminLogConfig));
