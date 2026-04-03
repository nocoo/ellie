// Admin announcement handlers — §9 Announcements
// Uses CRUD framework for full CRUD operations.
// Supports scheduling (start_at/end_at), forum targeting, and sticky sorting.

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createCreateHandler,
	createGetByIdHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { paginatedResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Column list ──────────────────────────────────────────────────

const ANNOUNCEMENT_COLUMNS = `
	id, title, content, forum_ids, sticky, start_at, end_at,
	status, author_id, author_name, created_at, updated_at
`.replace(/\s+/g, " ").trim();

// ─── Mapper ───────────────────────────────────────────────────────

function toAnnouncement(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		title: row.title as string,
		content: row.content as string,
		forumIds: row.forum_ids as string,
		sticky: row.sticky as number,
		startAt: row.start_at as number | null,
		endAt: row.end_at as number | null,
		status: row.status as number,
		authorId: row.author_id as number,
		authorName: row.author_name as string,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
	};
}

// ─── Entity Config ────────────────────────────────────────────────

const announcementConfig: EntityConfig = {
	table: "announcements",
	entityName: "ANNOUNCEMENT",
	auth: "admin",
	columns: ANNOUNCEMENT_COLUMNS,
	mapper: toAnnouncement,
	notFoundCode: "ANNOUNCEMENT_NOT_FOUND",

	filters: [
		{ param: "status", column: "status", type: "exact" },
	],
	listSort: "sticky DESC, created_at DESC",

	// Create fields
	createFields: [
		{
			name: "title",
			column: "title",
			required: true,
			validate: (v) => {
				if (typeof v !== "string") return "title must be a string";
				if (v.trim().length === 0) return "title cannot be empty";
				if (v.length > 200) return "title must be at most 200 characters";
				return null;
			},
		},
		{
			name: "content",
			column: "content",
			default: "",
			validate: (v) => {
				if (typeof v !== "string") return "content must be a string";
				if (v.length > 10000) return "content must be at most 10000 characters";
				return null;
			},
		},
		{
			name: "forumIds",
			column: "forum_ids",
			default: "",
			validate: (v) => {
				if (typeof v !== "string") return "forumIds must be a string";
				return null;
			},
		},
		{
			name: "sticky",
			column: "sticky",
			default: 0,
			validate: (v) => {
				if (typeof v !== "number") return "sticky must be a number";
				return null;
			},
		},
		{
			name: "startAt",
			column: "start_at",
			default: null,
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "startAt must be a number or null";
				return null;
			},
		},
		{
			name: "endAt",
			column: "end_at",
			default: null,
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "endAt must be a number or null";
				return null;
			},
		},
		{
			name: "status",
			column: "status",
			default: 1,
			validate: (v) => {
				if (typeof v !== "number") return "status must be a number";
				return null;
			},
		},
		{
			name: "authorId",
			column: "author_id",
			default: 0,
		},
		{
			name: "authorName",
			column: "author_name",
			default: "",
		},
	],

	// Update fields
	updateFields: [
		{
			name: "title",
			column: "title",
			validate: (v) => {
				if (typeof v !== "string") return "title must be a string";
				if (v.trim().length === 0) return "title cannot be empty";
				if (v.length > 200) return "title must be at most 200 characters";
				return null;
			},
		},
		{
			name: "content",
			column: "content",
			validate: (v) => {
				if (typeof v !== "string") return "content must be a string";
				if (v.length > 10000) return "content must be at most 10000 characters";
				return null;
			},
		},
		{
			name: "forumIds",
			column: "forum_ids",
			validate: (v) => {
				if (typeof v !== "string") return "forumIds must be a string";
				return null;
			},
		},
		{
			name: "sticky",
			column: "sticky",
			validate: (v) => {
				if (typeof v !== "number") return "sticky must be a number";
				return null;
			},
		},
		{
			name: "startAt",
			column: "start_at",
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "startAt must be a number or null";
				return null;
			},
		},
		{
			name: "endAt",
			column: "end_at",
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "endAt must be a number or null";
				return null;
			},
		},
		{
			name: "status",
			column: "status",
			validate: (v) => {
				if (typeof v !== "number") return "status must be a number";
				return null;
			},
		},
	],

	canDelete: true,
	batchDelete: true,
	batchLimit: 100,

	// Auto-fill created_at and updated_at
	beforeCreate: async (data) => {
		const now = Math.floor(Date.now() / 1000);
		data.created_at = now;
		data.updated_at = now;
		return undefined;
	},

	// Auto-update updated_at
	beforeUpdate: async (_id, data) => {
		data.updated_at = Math.floor(Date.now() / 1000);
		return undefined;
	},
};

// ─── GET /api/admin/announcements ─────────────────────────────────
// Custom list handler: supports status filter, active-only filter.

export const list = withEntityAuth(
	announcementConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);

		const conditions: string[] = [];
		const params: unknown[] = [];

		// Filter: status
		const statusFilter = url.searchParams.get("status");
		if (statusFilter !== null) {
			const status = Number.parseInt(statusFilter, 10);
			if (!Number.isNaN(status)) {
				conditions.push("status = ?");
				params.push(status);
			}
		}

		// Filter: active (currently within start_at/end_at window)
		const activeOnly = url.searchParams.get("active") === "true";
		if (activeOnly) {
			const now = Math.floor(Date.now() / 1000);
			conditions.push("status = 1");
			conditions.push("(start_at IS NULL OR start_at <= ?)");
			conditions.push("(end_at IS NULL OR end_at > ?)");
			params.push(now, now);
		}

		// Filter: forumId (check if forum_ids contains this ID)
		const forumIdFilter = url.searchParams.get("forumId");
		if (forumIdFilter) {
			// forum_ids is stored as comma-separated string like "1,2,3" or empty for all
			// Empty forum_ids means announcement applies to all forums
			conditions.push("(forum_ids = '' OR forum_ids LIKE ? OR forum_ids LIKE ? OR forum_ids LIKE ? OR forum_ids = ?)");
			params.push(
				`${forumIdFilter},%`,    // starts with ID
				`%,${forumIdFilter},%`,  // contains ID in middle
				`%,${forumIdFilter}`,    // ends with ID
				forumIdFilter,           // exact single ID
			);
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

		const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM announcements ${whereClause}`)
			.bind(...params)
			.first<{ total: number }>();

		const result = await env.DB.prepare(
			`SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements ${whereClause} ORDER BY sticky DESC, created_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...params, limit, (page - 1) * limit)
			.all();

		return paginatedResponse(
			result.results.map((r) => toAnnouncement(r as Record<string, unknown>)),
			countResult?.total ?? 0,
			page,
			limit,
			origin,
		);
	},
);

// ─── GET /api/admin/announcements/:id ────────────────────────────

export const getById = withEntityAuth(announcementConfig, createGetByIdHandler(announcementConfig));

// ─── POST /api/admin/announcements ───────────────────────────────

export const create = withEntityAuth(announcementConfig, createCreateHandler(announcementConfig));

// ─── PATCH /api/admin/announcements/:id ──────────────────────────

export const update = withEntityAuth(announcementConfig, createUpdateHandler(announcementConfig));

// ─── DELETE /api/admin/announcements/:id ─────────────────────────

export const remove = withEntityAuth(announcementConfig, createRemoveHandler(announcementConfig));

// ─── POST /api/admin/announcements/batch-delete ──────────────────

export const batchDelete = withEntityAuth(announcementConfig, createBatchDeleteHandler(announcementConfig));
