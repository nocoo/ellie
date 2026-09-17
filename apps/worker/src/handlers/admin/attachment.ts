// Admin attachment handlers — endpoints #43-#46
// Uses CRUD framework for reads and single deletion.
// Delete is metadata-only (no file deletion).

import { withEntityAuth } from "../../lib/adminHelpers";
import { invalidateAdminEntityCache } from "../../lib/cache/admin-entity-read";
import { bumpPostAttachmentsGen } from "../../lib/cache/invalidate";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createRemoveHandler } from "../../lib/crud";
import { toAttachment } from "../../lib/mappers";
import { jsonNoStoreResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

// ─── Entity Config ───────────────────────────────────────────────

const attachmentConfig: EntityConfig = {
	table: "attachments",
	entityName: "ATTACHMENT",
	auth: "admin",
	columns: "*",
	mapper: toAttachment,
	notFoundCode: "NOT_FOUND",
	filters: [
		{ param: "postId", column: "post_id", type: "exact", parse: "int" },
		{ param: "threadId", column: "thread_id", type: "exact", parse: "int" },
		{ param: "authorId", column: "author_id", type: "exact", parse: "int" },
		{ param: "isImage", column: "is_image", type: "exact", parse: "boolean" },
		{ param: "createdAt", column: "created_at", type: "range" },
	],
	canDelete: true,
	batchDelete: true,
	async afterDelete(_id, existing, env) {
		await Promise.all([
			bumpPostAttachmentsGen(env, existing.post_id as number),
			invalidateAdminEntityCache(env, "users"),
		]);
	},
};

// ─── CRUD Handlers ───────────────────────────────────────────────

/** #43 GET /api/admin/attachments — List attachments with filters and offset pagination */
export const list = withEntityAuth(attachmentConfig, createListHandler(attachmentConfig));

/** #44 GET /api/admin/attachments/:id — Get attachment by ID */
export const getById = withEntityAuth(attachmentConfig, createGetByIdHandler(attachmentConfig));

/** #45 DELETE /api/admin/attachments/:id — Delete attachment metadata (no file deletion) */
export const remove = withEntityAuth(attachmentConfig, createRemoveHandler(attachmentConfig));

/** #46 POST /api/admin/attachments/batch-delete — Batch delete attachment metadata (≤100) */
export const batchDelete = withEntityAuth(attachmentConfig, async (request, env) => {
	const origin = request.headers.get("Origin") ?? undefined;
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}
	const { ids } = body;
	if (!Array.isArray(ids) || ids.length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "ids must be a non-empty array" }, origin);
	}
	if (ids.length > 100) {
		return errorResponse(
			"BATCH_LIMIT_EXCEEDED",
			400,
			{ message: "Maximum 100 items per batch" },
			origin,
		);
	}
	const numericIds = [...new Set(ids.map(Number).filter((id) => !Number.isNaN(id)))];
	if (numericIds.length === 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "ids must contain valid numbers" },
			origin,
		);
	}
	// RETURNING captures the actual deleted rows in one atomic statement. Bump
	// each post once, after every attachment in this batch has been removed.
	const deleted = await env.DB.prepare(
		`DELETE FROM attachments WHERE id IN (${numericIds.map(() => "?").join(",")}) RETURNING post_id`,
	)
		.bind(...numericIds)
		.all<{ post_id: number }>();
	if (!deleted.success) throw new Error("Attachment deletion failed");
	if (deleted.results.length > 0) {
		await Promise.all([
			invalidateAdminEntityCache(env, "attachments"),
			invalidateAdminEntityCache(env, "users"),
			...[...new Set(deleted.results.map((row) => row.post_id))].map((postId) =>
				bumpPostAttachmentsGen(env, postId),
			),
		]);
	}
	return jsonNoStoreResponse({ deleted: true, count: deleted.results.length }, origin);
});
