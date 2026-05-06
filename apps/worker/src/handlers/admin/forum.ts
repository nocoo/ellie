// Admin forum handlers — CRUD framework + custom merge/reorder endpoints
import { ForumType } from "@ellie/types";
import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import type { EntityConfig } from "../../lib/crud";
import {
	createCreateHandler,
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { invalidateForumCacheAll } from "../../lib/forum-cache";
import { toForum } from "../../lib/mappers";
import { parseIdFromPath, parsePathSegment } from "../../lib/parseId";
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
		{
			name: "visibility",
			column: "visibility",
			default: "public",
			validate: (v) => {
				if (typeof v !== "string") return "visibility must be a string";
				if (!["public", "members", "staff", "admin"].includes(v)) {
					return "visibility must be public, members, staff, or admin";
				}
				return null;
			},
		},
		{
			name: "moderators",
			column: "moderators",
			default: "",
		},
		{
			name: "moderatorIds",
			column: "moderator_ids",
			default: "",
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
		{
			name: "moderators",
			column: "moderators",
			validate: (v) => {
				if (typeof v !== "string") return "moderators must be a string";
				if (v.length > 1000) return "moderators must be at most 1000 characters";
				return null;
			},
		},
		{
			name: "moderatorIds",
			column: "moderator_ids",
			validate: (v) => {
				if (typeof v !== "string") return "moderatorIds must be a string";
				// Format: comma-separated IDs like "1,2,3"
				if (v !== "" && !/^\d+(,\d+)*$/.test(v)) {
					return "moderatorIds must be comma-separated IDs";
				}
				return null;
			},
		},
		{
			name: "visibility",
			column: "visibility",
			validate: (v) => {
				if (typeof v !== "string") return "visibility must be a string";
				if (!["public", "members", "staff", "admin"].includes(v)) {
					return "visibility must be public, members, staff, or admin";
				}
				return null;
			},
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

	// Invalidate forum tree + volatile cache after any structural change
	async afterCreate(_id, _data, env) {
		await invalidateForumCacheAll(env);
	},
	async afterUpdate(_id, _data, _existing, env) {
		await invalidateForumCacheAll(env);
	},
	async afterDelete(_id, _existing, env) {
		await invalidateForumCacheAll(env);
	},
};

// ─── CRUD handlers (factory-generated) ───────────────────────────

/** #18 GET /api/admin/forums */
export const list = withEntityAuth(forumConfig, createListHandler(forumConfig));

/** #19 GET /api/admin/forums/:id */
export const getById = withEntityAuth(forumConfig, createGetByIdHandler(forumConfig));

// ─── F3-c helpers ────────────────────────────────────────────────
// Map of body field name → existing-row column for diff detection. Mirrors
// forumConfig.updateFields. `description` is intentionally only ever logged
// as a length / changed-flag — never the raw value.

const FORUM_UPDATE_FIELD_TO_COLUMN: Record<string, string> = {
	name: "name",
	description: "description",
	icon: "icon",
	displayOrder: "display_order",
	status: "status",
	type: "type",
	parentId: "parent_id",
	moderators: "moderators",
	moderatorIds: "moderator_ids",
	visibility: "visibility",
};

interface ForumUpdateDiff {
	changedFields: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
	descriptionLengthBefore?: number;
	descriptionLengthAfter?: number;
}

function buildForumUpdateDiff(
	body: Record<string, unknown>,
	existing: Record<string, unknown>,
): ForumUpdateDiff {
	const changedFields: string[] = [];
	const before: Record<string, unknown> = {};
	const after: Record<string, unknown> = {};
	let descriptionLengthBefore: number | undefined;
	let descriptionLengthAfter: number | undefined;

	for (const [field, column] of Object.entries(FORUM_UPDATE_FIELD_TO_COLUMN)) {
		if (!(field in body)) continue;
		const incoming = body[field];
		const current = existing[column];
		if (incoming === current) continue;
		changedFields.push(field);
		if (field === "description") {
			descriptionLengthBefore = typeof current === "string" ? current.length : 0;
			descriptionLengthAfter = typeof incoming === "string" ? incoming.length : 0;
		} else {
			before[field] = current ?? null;
			after[field] = incoming ?? null;
		}
	}

	return { changedFields, before, after, descriptionLengthBefore, descriptionLengthAfter };
}

// ─── CRUD handlers wrapped for audit ─────────────────────────────

/** #20 POST /api/admin/forums */
const createInner = createCreateHandler(forumConfig);

export const create = withEntityAuth(
	forumConfig,
	async (request: Request, env: Env): Promise<Response> => {
		// Snapshot body so we can capture submitted name/type/parentId for audit.
		let body: Record<string, unknown> = {};
		let bodyText = "";
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// inner returns its own 400
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await createInner(innerReq, env);

		if (res.status >= 200 && res.status < 300) {
			// Inner returns the created row in `data`. Clone to avoid consuming
			// the response body the framework already produced.
			let newId: number | null = null;
			try {
				const clone = res.clone();
				const json = (await clone.json()) as { data?: { id?: number } };
				newId = json?.data?.id ?? null;
			} catch {
				// best-effort
			}
			const description = typeof body.description === "string" ? body.description : "";
			await writeAdminLog(env, resolveActor(request), {
				action: "forum.create",
				targetType: "forum",
				targetId: newId,
				details: {
					name: typeof body.name === "string" ? body.name : null,
					type: typeof body.type === "string" ? body.type : "forum",
					parentId: typeof body.parentId === "number" ? body.parentId : 0,
					visibility: typeof body.visibility === "string" ? body.visibility : "public",
					descriptionLength: description.length,
				},
			});
		}

		return res;
	},
);

/** #21 PATCH /api/admin/forums/:id */
const updateInner = createUpdateHandler(forumConfig);

export const update = withEntityAuth(
	forumConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);

		let body: Record<string, unknown> = {};
		let bodyText = "";
		let existing: Record<string, unknown> | null = null;
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// inner returns 400
		}
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM forums WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort snapshot
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await updateInner(innerReq, env);

		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			const diff = buildForumUpdateDiff(body, existing);
			if (diff.changedFields.length > 0) {
				const details: Record<string, unknown> = {
					parentId: existing.parent_id ?? null,
					changedFields: diff.changedFields,
				};
				if (diff.descriptionLengthBefore !== undefined) {
					details.descriptionLengthBefore = diff.descriptionLengthBefore;
					details.descriptionLengthAfter = diff.descriptionLengthAfter;
				}
				if (Object.keys(diff.before).length > 0) {
					details.before = diff.before;
					details.after = diff.after;
				}
				await writeAdminLog(env, resolveActor(request), {
					action: "forum.update",
					targetType: "forum",
					targetId: id,
					details,
				});
			}
		}

		return res;
	},
);

/** #22 DELETE /api/admin/forums/:id */
const removeInner = createRemoveHandler(forumConfig);

export const remove = withEntityAuth(
	forumConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);

		let existing: Record<string, unknown> | null = null;
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM forums WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort snapshot
			}
		}

		const res = await removeInner(request, env);

		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			await writeAdminLog(env, resolveActor(request), {
				action: "forum.delete",
				targetType: "forum",
				targetId: id,
				details: {
					name: existing.name ?? null,
					parentId: existing.parent_id ?? null,
					type: existing.type ?? null,
				},
			});
		}

		return res;
	},
);

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

		// Source/target forum + thread/post counts are 4 independent reads.
		// Run them in parallel to halve D1 round-trip latency on the merge
		// admin operation.
		const [source, target, threadCount, postCount] = await Promise.all([
			env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(sourceId).first(),
			env.DB.prepare("SELECT id FROM forums WHERE id = ?").bind(targetForumId).first(),
			env.DB.prepare("SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ?")
				.bind(sourceId)
				.first<{ cnt: number }>(),
			env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE forum_id = ?")
				.bind(sourceId)
				.first<{ cnt: number }>(),
		]);

		if (!source) {
			return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
		}
		if (!target) {
			return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
		}

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

		// Invalidate both caches (structure + counts changed by merge)
		await invalidateForumCacheAll(env);

		// F3-c: audit only after the mutation has committed.
		await writeAdminLog(env, resolveActor(request), {
			action: "forum.merge",
			targetType: "forum",
			targetId: sourceId,
			details: {
				sourceForumId: sourceId,
				targetForumId,
				threadsMoved,
				postsMoved,
			},
		});

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

		const orderItems = orders as { id: number; displayOrder: number }[];

		// F3-c: snapshot existing display_order for the requested ids so the
		// audit row only records rows that actually exist AND actually changed.
		// Missing ids are dropped from the audit (the UPDATE is a no-op for
		// them anyway); unchanged rows are dropped to avoid recording false
		// "edits" when a reorder request matches current state.
		const ids = orderItems.map((o) => o.id);
		const placeholders = ids.map(() => "?").join(",");
		const existingRows = await env.DB.prepare(
			`SELECT id, display_order FROM forums WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all<{ id: number; display_order: number }>();
		const existingById = new Map<number, number>(
			(existingRows.results ?? []).map((r) => [r.id, r.display_order]),
		);
		const changedRows = orderItems
			.filter((o) => existingById.has(o.id) && existingById.get(o.id) !== o.displayOrder)
			.map((o) => ({
				id: o.id,
				before: existingById.get(o.id) ?? null,
				after: o.displayOrder,
			}));

		const statements = orderItems.map((item) =>
			env.DB.prepare("UPDATE forums SET display_order = ? WHERE id = ?").bind(
				item.displayOrder,
				item.id,
			),
		);

		await env.DB.batch(statements);

		// Invalidate forum tree cache (display order is in tree)
		await invalidateForumCacheAll(env);

		// F3-c: only audit when something actually changed. No-op reorders
		// (all ids missing or all display_order already match) skip the
		// admin_logs row entirely.
		if (changedRows.length > 0) {
			await writeAdminLog(env, resolveActor(request), {
				action: "forum.reorder",
				targetType: "forum",
				targetId: null,
				details: { count: changedRows.length, orders: changedRows },
			});
		}

		return jsonResponse({ updated: true, count: orders.length }, origin);
	},
);
