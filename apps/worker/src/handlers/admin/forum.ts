// Admin forum handlers — CRUD framework + custom merge/reorder endpoints
import { ForumType } from "@ellie/types";
import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createCreateHandler,
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { toForum } from "../../lib/mappers";
import { parsePathSegment } from "../../lib/parseId";
import { recalcForumMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Validation helpers ──────────────────────────────────────────

const VALID_FORUM_TYPES = new Set(Object.values(ForumType));
const MAX_REORDER_ITEMS = 200;

function validateName(value: unknown): string | null {
	if (typeof value !== "string" || value.trim().length === 0) return "name is required";
	if (value.length > 100) return "name must be at most 100 characters";
	return null;
}

function validateType(value: unknown): string | null {
	if (typeof value !== "string" || !VALID_FORUM_TYPES.has(value as ForumType)) {
		return "Invalid type";
	}
	return null;
}

function validateStatus(value: unknown): string | null {
	if (typeof value !== "number" || (value !== 0 && value !== 1)) {
		return "status must be 0 or 1";
	}
	return null;
}

// ─── Entity config ───────────────────────────────────────────────

const forumConfig: EntityConfig = {
	table: "forums",
	entityName: "FORUM",
	auth: "admin",
	columns: "*",
	mapper: toForum,
	listPaginated: false,
	listSort: "parent_id, display_order",
	notFoundCode: "FORUM_NOT_FOUND",
	createFields: [
		{
			name: "name",
			column: "name",
			required: true,
			validate: validateName,
		},
		{
			name: "type",
			column: "type",
			default: "forum",
			validate: validateType,
		},
		{
			name: "parentId",
			column: "parent_id",
			default: 0,
		},
		{
			name: "description",
			column: "description",
			default: "",
		},
		{
			name: "icon",
			column: "icon",
			default: "",
		},
		{
			name: "displayOrder",
			column: "display_order",
			default: 0,
		},
		{
			name: "status",
			column: "status",
			default: 1,
			validate: validateStatus,
		},
	],
	updateFields: [
		{
			name: "name",
			column: "name",
			validate: validateName,
		},
		{
			name: "description",
			column: "description",
		},
		{
			name: "icon",
			column: "icon",
		},
		{
			name: "displayOrder",
			column: "display_order",
		},
		{
			name: "status",
			column: "status",
			validate: validateStatus,
		},
		{
			name: "type",
			column: "type",
			validate: validateType,
		},
		{
			name: "parentId",
			column: "parent_id",
		},
	],
	canDelete: true,

	// ─── Lifecycle hooks ─────────────────────────────────────

	async beforeCreate(data, env, origin) {
		const parentId = (data.parent_id as number) ?? 0;
		if (parentId !== 0) {
			const parent = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
				.bind(parentId)
				.first();
			if (!parent) {
				return errorResponse("INVALID_BODY", 400, { message: "Parent forum not found" }, origin);
			}
		}
		// Initialize counter columns for new forums
		data.threads = 0;
		data.posts = 0;
		data.last_thread_id = 0;
		data.last_post_at = 0;
		data.last_poster = "";
	},

	async beforeDelete(id, _existing, env, origin) {
		const countResult = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ?",
		)
			.bind(id)
			.first<{ cnt: number }>();
		if (countResult && countResult.cnt > 0) {
			return errorResponse("FORUM_HAS_THREADS", 409, { threadCount: countResult.cnt }, origin);
		}
	},
};

// ─── CRUD handlers (factory-generated) ───────────────────────────

/** #18 GET /api/admin/forums */
export const list = withEntityAuth(forumConfig, createListHandler(forumConfig));

/** #19 GET /api/admin/forums/:id */
export const getById = withEntityAuth(forumConfig, createGetByIdHandler(forumConfig));

/** #20 POST /api/admin/forums */
export const create = withEntityAuth(forumConfig, createCreateHandler(forumConfig));

/** #21 PATCH /api/admin/forums/:id */
export const update = withEntityAuth(forumConfig, createUpdateHandler(forumConfig));

/** #22 DELETE /api/admin/forums/:id */
export const remove = withEntityAuth(forumConfig, createRemoveHandler(forumConfig));

// ─── Custom endpoints ────────────────────────────────────────────

/** #23 POST /api/admin/forums/:id/merge — Merge source forum into target */
export const merge = withEntityAuth(
	forumConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		// Parse source forum ID from path: /api/admin/forums/:id/merge
		const sourceId = parsePathSegment(request, 1);
		if (sourceId === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const targetForumId = body.targetForumId;
		if (typeof targetForumId !== "number") {
			return errorResponse("INVALID_BODY", 400, { message: "targetForumId is required" }, origin);
		}

		if (sourceId === targetForumId) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "Cannot merge a forum into itself" },
				origin,
			);
		}

		// Verify source forum exists
		const source = await env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(sourceId).first();
		if (!source) {
			return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
		}

		// Verify target forum exists
		const target = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
			.bind(targetForumId)
			.first();
		if (!target) {
			return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
		}

		// Count threads and posts to move
		const threadCount = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ?",
		)
			.bind(sourceId)
			.first<{ cnt: number }>();
		const postCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE forum_id = ?")
			.bind(sourceId)
			.first<{ cnt: number }>();

		const threadsMoved = threadCount?.cnt ?? 0;
		const postsMoved = postCount?.cnt ?? 0;

		// Batch: move threads, move posts, update target counts, delete source
		const statements: D1PreparedStatement[] = [
			env.DB.prepare("UPDATE threads SET forum_id = ? WHERE forum_id = ?").bind(
				targetForumId,
				sourceId,
			),
			env.DB.prepare("UPDATE posts SET forum_id = ? WHERE forum_id = ?").bind(
				targetForumId,
				sourceId,
			),
			env.DB.prepare(
				"UPDATE forums SET threads = threads + ?, posts = posts + ? WHERE id = ?",
			).bind(threadsMoved, postsMoved, targetForumId),
			env.DB.prepare("DELETE FROM forums WHERE id = ?").bind(sourceId),
		];

		await env.DB.batch(statements);

		// Recalc target forum metadata after merge
		await recalcForumMetadata(env, targetForumId as number);

		return jsonResponse(
			{
				merged: true,
				sourceForumId: sourceId,
				targetForumId,
				threadsMoved,
				postsMoved,
			},
			origin,
		);
	},
);

/** #24 POST /api/admin/forums/reorder — Batch reorder forums */
export const reorder = withEntityAuth(
	forumConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const orders = body.orders;
		if (!Array.isArray(orders) || orders.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "orders must be a non-empty array" },
				origin,
			);
		}

		if (orders.length > MAX_REORDER_ITEMS) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_REORDER_ITEMS} items per batch` },
				origin,
			);
		}

		// Validate each order entry
		for (const item of orders) {
			if (
				typeof item !== "object" ||
				item === null ||
				typeof (item as Record<string, unknown>).id !== "number" ||
				typeof (item as Record<string, unknown>).displayOrder !== "number"
			) {
				return errorResponse(
					"INVALID_BODY",
					400,
					{ message: "Each order must have numeric id and displayOrder" },
					origin,
				);
			}
		}

		const statements = (orders as { id: number; displayOrder: number }[]).map((item) =>
			env.DB.prepare("UPDATE forums SET display_order = ? WHERE id = ?").bind(
				item.displayOrder,
				item.id,
			),
		);

		await env.DB.batch(statements);

		return jsonResponse({ updated: true, count: orders.length }, origin);
	},
);
