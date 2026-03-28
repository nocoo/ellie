// Admin attachment handlers — endpoints #43-#46
// Uses CRUD framework for list, getById, remove, batchDelete.
// Delete is metadata-only (no file deletion).

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
} from "../../lib/crud";
import { toAttachment } from "../../lib/mappers";

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
	],
	canDelete: true,
	batchDelete: true,
};

// ─── CRUD Handlers ───────────────────────────────────────────────

/** #43 GET /api/admin/attachments — List attachments with filters and offset pagination */
export const list = withEntityAuth(attachmentConfig, createListHandler(attachmentConfig));

/** #44 GET /api/admin/attachments/:id — Get attachment by ID */
export const getById = withEntityAuth(attachmentConfig, createGetByIdHandler(attachmentConfig));

/** #45 DELETE /api/admin/attachments/:id — Delete attachment metadata (no file deletion) */
export const remove = withEntityAuth(attachmentConfig, createRemoveHandler(attachmentConfig));

/** #46 POST /api/admin/attachments/batch-delete — Batch delete attachment metadata (≤100) */
export const batchDelete = withEntityAuth(
	attachmentConfig,
	createBatchDeleteHandler(attachmentConfig),
);
