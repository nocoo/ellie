// Admin report handlers — §6 Reports Management
// Uses CRUD framework for getById, batchDelete.
// Custom handlers for list (status/type filters) and update (resolve/dismiss).

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createGetByIdHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse, paginatedResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Column list ──────────────────────────────────────────────────

const REPORT_COLUMNS = `
	id, type, target_id, reporter_id, reporter_name,
	reason, status, handler_id, handler_name, handled_at, created_at
`.replace(/\s+/g, " ").trim();

// ─── Mapper ───────────────────────────────────────────────────────

function toReport(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		type: row.type as string,
		targetId: row.target_id as number,
		reporterId: row.reporter_id as number,
		reporterName: row.reporter_name as string,
		reason: row.reason as string,
		status: row.status as string,
		handlerId: row.handler_id as number | null,
		handlerName: row.handler_name as string,
		handledAt: row.handled_at as number | null,
		createdAt: row.created_at as number,
	};
}

// ─── Entity Config ────────────────────────────────────────────────

const reportConfig: EntityConfig = {
	table: "reports",
	entityName: "REPORT",
	auth: "admin",
	columns: REPORT_COLUMNS,
	mapper: toReport,
	notFoundCode: "REPORT_NOT_FOUND",

	filters: [
		{ param: "status", column: "status", type: "exact" },
		{ param: "type", column: "type", type: "exact" },
		{ param: "reporterId", column: "reporter_id", type: "exact" },
	],
	listSort: "created_at DESC",

	// Update fields for resolve/dismiss
	updateFields: [
		{
			name: "status",
			column: "status",
			validate: (v) => {
				if (typeof v !== "string") return "status must be a string";
				if (!["pending", "resolved", "dismissed"].includes(v)) {
					return "status must be pending, resolved, or dismissed";
				}
				return null;
			},
		},
	],

	canDelete: true,
	batchDelete: true,
	batchLimit: 100,
};

// ─── GET /api/admin/reports ───────────────────────────────────────
// Custom list handler: supports status, type, reporterId filters.

export const list = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);

		const conditions: string[] = [];
		const params: unknown[] = [];

		// Filter: status
		const statusFilter = url.searchParams.get("status");
		if (statusFilter && ["pending", "resolved", "dismissed"].includes(statusFilter)) {
			conditions.push("status = ?");
			params.push(statusFilter);
		}

		// Filter: type
		const typeFilter = url.searchParams.get("type");
		if (typeFilter && ["thread", "post", "user"].includes(typeFilter)) {
			conditions.push("type = ?");
			params.push(typeFilter);
		}

		// Filter: reporterId
		const reporterIdFilter = url.searchParams.get("reporterId");
		if (reporterIdFilter) {
			const reporterId = Number.parseInt(reporterIdFilter, 10);
			if (!Number.isNaN(reporterId)) {
				conditions.push("reporter_id = ?");
				params.push(reporterId);
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

		const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM reports ${whereClause}`)
			.bind(...params)
			.first<{ total: number }>();

		const result = await env.DB.prepare(
			`SELECT ${REPORT_COLUMNS} FROM reports ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...params, limit, (page - 1) * limit)
			.all();

		return paginatedResponse(
			result.results.map((r) => toReport(r as Record<string, unknown>)),
			countResult?.total ?? 0,
			page,
			limit,
			origin,
		);
	},
);

// ─── GET /api/admin/reports/:id ──────────────────────────────────

export const getById = withEntityAuth(reportConfig, createGetByIdHandler(reportConfig));

// ─── PATCH /api/admin/reports/:id ────────────────────────────────
// Custom update handler to set handler_id, handler_name, handled_at when resolving/dismissing.

export const update = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		const id = url.pathname.split("/").pop();

		if (!id || Number.isNaN(Number.parseInt(id, 10))) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid report ID" }, origin);
		}

		// Parse body
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const { status, handlerId, handlerName } = body;

		// Validate status
		if (typeof status !== "string" || !["pending", "resolved", "dismissed"].includes(status)) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "status must be pending, resolved, or dismissed" },
				origin,
			);
		}

		// Check report exists
		const existing = await env.DB.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`)
			.bind(id)
			.first();
		if (!existing) {
			return errorResponse("REPORT_NOT_FOUND", 404, undefined, origin);
		}

		// Build update
		const now = Math.floor(Date.now() / 1000);
		const updates: string[] = ["status = ?"];
		const updateParams: unknown[] = [status];

		if (status !== "pending") {
			// Set handler info when resolving or dismissing
			updates.push("handler_id = ?");
			updateParams.push(typeof handlerId === "number" ? handlerId : 0);

			updates.push("handler_name = ?");
			updateParams.push(typeof handlerName === "string" ? handlerName : "System");

			updates.push("handled_at = ?");
			updateParams.push(now);
		} else {
			// Clear handler info when reverting to pending
			updates.push("handler_id = NULL");
			updates.push("handler_name = ''");
			updates.push("handled_at = NULL");
		}

		await env.DB.prepare(`UPDATE reports SET ${updates.join(", ")} WHERE id = ?`)
			.bind(...updateParams, id)
			.run();

		// Fetch updated record
		const updated = await env.DB.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`)
			.bind(id)
			.first();

		return jsonResponse(toReport(updated as Record<string, unknown>), origin);
	},
);

// ─── POST /api/admin/reports/batch-delete ────────────────────────

export const batchDelete = withEntityAuth(reportConfig, createBatchDeleteHandler(reportConfig));
