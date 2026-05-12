// Admin censor word handlers — CRUD framework + test endpoint
import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
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
import { parseIdFromPath } from "../../lib/parseId";
import { jsonResponse } from "../../lib/response";

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

	async beforeCreate(data, env, origin) {
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

		// Auto-fill admin fields (no user context in worker)
		data.admin_id = 0;
		data.admin_name = "System";
	},

	async beforeUpdate(id, data, existing, env, origin) {
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
const censorCreateInner = createCreateHandler(censorWordConfig);

export const create = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env): Promise<Response> => {
		let body: Record<string, unknown> = {};
		let bodyText = "";
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// inner returns 400
		}
		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});
		const res = await censorCreateInner(innerReq, env);
		if (res.status >= 200 && res.status < 300) {
			let newId: number | null = null;
			try {
				const json = (await res.clone().json()) as { data?: { id?: number } };
				newId = json?.data?.id ?? null;
			} catch {
				// best-effort
			}
			await writeAdminLog(env, resolveActor(request, env), {
				action: "censor_word.create",
				targetType: "censor_word",
				targetId: newId,
				details: {
					find: typeof body.find === "string" ? body.find : null,
					replacement: typeof body.replacement === "string" ? body.replacement : "",
					action: typeof body.action === "string" ? body.action : "replace",
				},
			});
		}
		return res;
	},
);

/** #57 PATCH /api/admin/censor-words/:id */
const censorUpdateInner = createUpdateHandler(censorWordConfig);

export const update = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);
		let body: Record<string, unknown> = {};
		let bodyText = "";
		let existing: Record<string, unknown> | null = null;
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// inner 400
		}
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM censor_words WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort
			}
		}
		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});
		const res = await censorUpdateInner(innerReq, env);
		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			const changedFields: string[] = [];
			const before: Record<string, unknown> = {};
			const after: Record<string, unknown> = {};
			for (const field of ["find", "replacement", "action"] as const) {
				if (!(field in body)) continue;
				const incoming = body[field];
				const current = existing[field];
				if (incoming === current) continue;
				changedFields.push(field);
				before[field] = current ?? null;
				after[field] = incoming ?? null;
			}
			if (changedFields.length > 0) {
				await writeAdminLog(env, resolveActor(request, env), {
					action: "censor_word.update",
					targetType: "censor_word",
					targetId: id,
					details: { changedFields, before, after },
				});
			}
		}
		return res;
	},
);

/** #58 DELETE /api/admin/censor-words/:id */
const censorRemoveInner = createRemoveHandler(censorWordConfig);

export const remove = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);
		let existing: Record<string, unknown> | null = null;
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM censor_words WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort
			}
		}
		const res = await censorRemoveInner(request, env);
		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			await writeAdminLog(env, resolveActor(request, env), {
				action: "censor_word.delete",
				targetType: "censor_word",
				targetId: id,
				details: {
					find: existing.find ?? null,
					replacement: existing.replacement ?? "",
					action: existing.action ?? null,
				},
			});
		}
		return res;
	},
);

/** #59 POST /api/admin/censor-words/batch-delete */
const censorBatchDeleteInner = createBatchDeleteHandler(censorWordConfig);

export const batchDelete = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env): Promise<Response> => {
		let ids: unknown[] = [];
		let bodyText = "";
		try {
			bodyText = await request.text();
			const parsed = JSON.parse(bodyText) as { ids?: unknown[] };
			if (Array.isArray(parsed?.ids)) ids = parsed.ids;
		} catch {
			// inner 400
		}
		const numericIds = ids
			.map((id) => Number(id))
			.filter((id): id is number => !Number.isNaN(id))
			.slice(0, censorWordConfig.batchLimit ?? 100);

		let existingIds: number[] = [];
		if (numericIds.length > 0) {
			try {
				const placeholders = numericIds.map(() => "?").join(",");
				const rows = await env.DB.prepare(
					`SELECT id FROM censor_words WHERE id IN (${placeholders})`,
				)
					.bind(...numericIds)
					.all<{ id: number }>();
				existingIds = (rows.results ?? []).map((r) => r.id);
			} catch {
				// fall through
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});
		const res = await censorBatchDeleteInner(innerReq, env);

		if (res.status >= 200 && res.status < 300 && existingIds.length > 0) {
			await writeAdminLog(env, resolveActor(request, env), {
				action: "censor_word.batch_delete",
				targetType: "censor_word",
				targetId: null,
				details: { ids: existingIds, count: existingIds.length },
			});
		}
		return res;
	},
);

// ─── Custom endpoint ─────────────────────────────────────────────

/** #60 POST /api/admin/censor-words/test — test content against censor rules */
export const test = withEntityAuth(
	censorWordConfig,
	async (request: Request, env: Env): Promise<Response> => {
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
