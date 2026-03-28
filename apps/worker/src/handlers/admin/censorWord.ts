// Admin censor word handlers — CRUD framework + test endpoint
import { withEntityAuth } from "../../lib/adminHelpers";
import { checkCensorWords } from "../../lib/censor";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createCreateHandler,
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { toCensorWord } from "../../lib/mappers";
import { jsonResponse } from "../../lib/response";
import type { AuthUser } from "../../middleware/auth";
import { errorResponse } from "../../middleware/error";

// ─── Validation helpers ──────────────────────────────────────────

const VALID_ACTIONS = new Set(["ban", "replace"]);

function validateFind(value: unknown): string | null {
	if (typeof value !== "string" || value.trim().length < 2) {
		return "find must be at least 2 characters";
	}
	return null;
}

function validateAction(value: unknown): string | null {
	if (typeof value !== "string" || !VALID_ACTIONS.has(value)) {
		return "action must be 'ban' or 'replace'";
	}
	return null;
}

/**
 * If `find` is a regex pattern (starts and ends with /), validate syntax.
 * Returns an error Response or undefined to continue.
 */
function validateRegexSyntax(find: string, origin?: string): Response | undefined {
	if (find.startsWith("/") && find.lastIndexOf("/") > 0) {
		const pattern = find.slice(1, find.lastIndexOf("/"));
		try {
			new RegExp(pattern);
		} catch {
			return errorResponse(
				"CENSOR_WORD_INVALID",
				400,
				{ message: "Invalid regex syntax in find pattern" },
				origin,
			);
		}
	}
	return undefined;
}

/**
 * Check for duplicate `find` value in censor_words table.
 * Returns an error Response if duplicate exists, undefined otherwise.
 */
async function checkDuplicate(
	env: Env,
	find: string,
	excludeId?: number,
	origin?: string,
): Promise<Response | undefined> {
	const existing = await env.DB.prepare("SELECT id FROM censor_words WHERE find = ?")
		.bind(find)
		.first<{ id: number }>();
	if (existing && existing.id !== excludeId) {
		return errorResponse("CENSOR_WORD_DUPLICATE", 409, undefined, origin);
	}
	return undefined;
}

// ─── Entity config ───────────────────────────────────────────────

const censorWordConfig: EntityConfig = {
	table: "censor_words",
	entityName: "CENSOR_WORD",
	auth: "admin",
	columns: "*",
	mapper: toCensorWord,
	notFoundCode: "CENSOR_WORD_NOT_FOUND",
	filters: [
		{ param: "find", column: "find", type: "like" },
		{ param: "action", column: "action", type: "exact" },
	],
	createFields: [
		{
			name: "find",
			column: "find",
			required: true,
			validate: validateFind,
		},
		{
			name: "replacement",
			column: "replacement",
			default: "**",
		},
		{
			name: "action",
			column: "action",
			default: "replace",
			validate: validateAction,
		},
	],
	updateFields: [
		{
			name: "find",
			column: "find",
			validate: validateFind,
		},
		{
			name: "replacement",
			column: "replacement",
		},
		{
			name: "action",
			column: "action",
			validate: validateAction,
		},
	],
	canDelete: true,
	batchDelete: true,

	// ─── Lifecycle hooks ─────────────────────────────────────

	async beforeCreate(data, user, env) {
		const origin = undefined;
		const find = data.find as string;

		// Validate regex syntax
		const regexErr = validateRegexSyntax(find, origin);
		if (regexErr) return regexErr;

		// Check duplicate
		const dupErr = await checkDuplicate(env, find, undefined, origin);
		if (dupErr) return dupErr;

		// If action is ban, ignore replacement
		if (data.action === "ban") {
			data.replacement = "";
		}

		// Auto-fill admin fields
		data.admin_id = user.userId;
		const adminRow = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>();
		data.admin_name = adminRow?.username ?? "Unknown";
	},

	async beforeUpdate(id, data, existing, _user, env) {
		const origin = undefined;
		const find = (data.find as string | undefined) ?? (existing.find as string);

		// Validate regex syntax if find is being changed
		if (data.find !== undefined) {
			const regexErr = validateRegexSyntax(find, origin);
			if (regexErr) return regexErr;

			// Check duplicate only if find is changing
			const dupErr = await checkDuplicate(env, find, id, origin);
			if (dupErr) return dupErr;
		}

		// If action is changing to ban, clear replacement
		const action = (data.action as string | undefined) ?? (existing.action as string);
		if (action === "ban") {
			data.replacement = "";
		}
	},
};

// ─── CRUD handlers (factory-generated) ───────────────────────────

/** #54 GET /api/admin/censor-words */
export const list = withEntityAuth(censorWordConfig, createListHandler(censorWordConfig));

/** #55 GET /api/admin/censor-words/:id */
export const getById = withEntityAuth(censorWordConfig, createGetByIdHandler(censorWordConfig));

/** #56 POST /api/admin/censor-words */
export const create = withEntityAuth(censorWordConfig, createCreateHandler(censorWordConfig));

/** #57 PATCH /api/admin/censor-words/:id */
export const update = withEntityAuth(censorWordConfig, createUpdateHandler(censorWordConfig));

/** #58 DELETE /api/admin/censor-words/:id */
export const remove = withEntityAuth(censorWordConfig, createRemoveHandler(censorWordConfig));

/** #59 POST /api/admin/censor-words/batch-delete */
export const batchDelete = withEntityAuth(
	censorWordConfig,
	createBatchDeleteHandler(censorWordConfig),
);

// ─── Custom endpoint ─────────────────────────────────────────────

/** #60 POST /api/admin/censor-words/test — test content against censor rules */
export const test = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env, _user: AuthUser): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const { content } = body;
		if (typeof content !== "string" || content.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "content is required and must be a non-empty string" },
				origin,
			);
		}

		const result = await checkCensorWords(content, env);
		return jsonResponse(result, origin);
	},
);
