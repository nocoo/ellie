// Admin report handlers — §6 Reports Management
// Uses CRUD framework for getById, batchDelete.
// Custom handlers for list (status/type filters) and update (resolve/dismiss).

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import { getAdminReport } from "../../lib/cache/admin-report-read";
import type { EntityConfig } from "../../lib/crud";
import { createBatchDeleteHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { parseIdFromPath } from "../../lib/parseId";
import { jsonNoStoreResponse, paginatedNoStoreResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Column list ──────────────────────────────────────────────────

const REPORT_COLUMNS = `
	id, type, target_id, reporter_id, reporter_name,
	reason, status, handler_id, handler_name, handled_at, created_at
`
	.replace(/\s+/g, " ")
	.trim();

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
// JOIN with posts to get thread_id for navigation.

export const list = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		const statusFilter = url.searchParams.get("status");
		const typeFilter = url.searchParams.get("type");
		const reporterRaw = Number.parseInt(url.searchParams.get("reporterId") ?? "", 10);
		const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
			100,
		);
		if (page < 1 || Number.isNaN(page)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
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
				resource: "reports",
				operation: "list",
				status:
					statusFilter && ["pending", "resolved", "dismissed"].includes(statusFilter)
						? statusFilter
						: null,
				type: typeFilter && ["thread", "post", "user"].includes(typeFilter) ? typeFilter : null,
				reporterId: Number.isSafeInteger(reporterRaw) && reporterRaw > 0 ? reporterRaw : null,
				page,
				limit,
			},
		});
		return paginatedNoStoreResponse(data.items, data.total, data.page, data.limit, origin);
	},
);

// ─── GET /api/admin/reports/:id ──────────────────────────────────
// Custom handler with JOIN to get thread_id

export const getById = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parseIdFromPath(request);
		if (id === null || id <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid report ID" }, origin);
		}
		const data = await getAdminReport<unknown>(env, ctx, {
			family: "admin:display",
			scope: "admin",
			params: { resource: "reports", operation: "detail", id },
		});
		if (data === null) return errorResponse("REPORT_NOT_FOUND", 404, undefined, origin);
		return jsonNoStoreResponse(data, origin);
	},
);

// ─── PATCH /api/admin/reports/:id ────────────────────────────────
// Custom update handler to set handler_id, handler_name, handled_at when resolving/dismissing.

export const update = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parseIdFromPath(request);

		if (id === null || id <= 0) {
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

		// F3-a: emit audit only when transitioning into a terminal state.
		// pending → pending or terminal → pending revert is not currently logged
		// (low-risk, no-op observers); resolved/dismissed both get a row.
		if (status === "resolved" || status === "dismissed") {
			await writeAdminLog(env, resolveActor(request, env), {
				action: status === "resolved" ? "report.resolve" : "report.dismiss",
				targetType: "report",
				targetId: id,
				details: {
					previousStatus: (existing as Record<string, unknown>).status ?? null,
					reportType: (existing as Record<string, unknown>).type ?? null,
				},
			});
		}

		// Fetch updated record
		const updated = await env.DB.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`)
			.bind(id)
			.first();

		return jsonNoStoreResponse(toReport(updated as Record<string, unknown>), origin);
	},
);

// ─── POST /api/admin/reports/batch-delete ────────────────────────
//
// F3-a: wrap the generic CRUD batch-delete handler so we can emit an audit
// row only when the underlying mutation succeeds (HTTP 2xx). Failure paths
// are intentionally not logged — keeps admin_logs as a "what changed" trail,
// not an attempted-action trail.

const batchDeleteInner = createBatchDeleteHandler(reportConfig);

export const batchDelete = withEntityAuth(
	reportConfig,
	async (request: Request, env: Env): Promise<Response> => {
		// Snapshot the requested ids before the body stream is consumed by the
		// inner handler. We re-build a fresh Request so the inner handler still
		// has a body to parse.
		let ids: unknown[] = [];
		let bodyText = "";
		try {
			bodyText = await request.text();
			const parsed = JSON.parse(bodyText) as { ids?: unknown[] };
			if (Array.isArray(parsed?.ids)) ids = parsed.ids;
		} catch {
			// fall through — inner handler will return its own 400
		}

		// Coerce ids the same way createBatchDeleteHandler does (Number(id) +
		// drop NaN), then snapshot which ones actually exist *before* the
		// inner handler deletes them. We log only what we know was really
		// removed, not the caller's intent.
		const numericIds = ids
			.map((id) => Number(id))
			.filter((id): id is number => !Number.isNaN(id))
			.slice(0, 100);

		let existingIds: number[] = [];
		if (numericIds.length > 0) {
			try {
				const placeholders = numericIds.map(() => "?").join(",");
				const rows = await env.DB.prepare(`SELECT id FROM reports WHERE id IN (${placeholders})`)
					.bind(...numericIds)
					.all<{ id: number }>();
				existingIds = (rows.results ?? []).map((r) => r.id);
			} catch {
				// best-effort snapshot — fall through with []
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await batchDeleteInner(innerReq, env);

		if (res.status >= 200 && res.status < 300) {
			// reportConfig has no beforeDelete skip path, so the snapshot of
			// rows that existed at the moment of the SELECT is the exact set
			// the inner CRUD handler will have deleted. No need to re-parse
			// inner's response body.
			await writeAdminLog(env, resolveActor(request, env), {
				action: "report.batch_delete",
				targetType: "report",
				targetId: null,
				details: { ids: existingIds, count: existingIds.length },
			});
		}

		return res;
	},
);
