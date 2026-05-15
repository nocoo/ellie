// Admin handlers for `forum_thread_types` (主题分类) — Phase 2 / F.
//
// Surface (mounted in src/index.ts):
//   GET    /api/admin/forums/:forumId/thread-types                 → list
//   POST   /api/admin/forums/:forumId/thread-types                 → create
//   PATCH  /api/admin/forums/:forumId/thread-types/reorder         → reorder
//   PATCH  /api/admin/forums/:forumId/thread-types-config          → 4-switch
//   PATCH  /api/admin/forum-thread-types/:id                       → update
//   DELETE /api/admin/forum-thread-types/:id                       → delete
//
// Reviewer pins (msg bb4aae2a + 2935495a):
//   • thread_types_required=1 ⇒ thread_types_enabled=1, rejected at
//     this admin layer so the create resolver never sees a "required
//     but disabled" forum (the public resolver would silently drop it).
//   • Same-commit minimal invalidation:
//       – 4-switch update     → bumpForumTreeGen + bumpForumSummaryGen
//                               (the latter also rolls forum:meta:v2
//                               because meta keys embed `forum:summary:gen`).
//       – type create/update(name|displayOrder|enabled|moderator_only)
//         /reorder/delete-or-soft-disable
//                             → bumpForumTreeGen (Forum.threadTypes config
//                               lives in forum:tree:v2) + bumpThreadListGen(forumId)
//                               so the per-forum thread-list cache (which can
//                               carry `type_name` denorm in future payloads
//                               and `?typeId=` filtered slices today) stays
//                               consistent with the new enabled set.
//   • Public `/forums/:id/thread-types` reads D1 directly — no dedicated
//     KV cache to drop, only the meta-visibility gate. The bumps above
//     keep that gate's payload (forum:tree:v2 / forum:meta:v2) consistent
//     with the new switches.
//   • Delete with referencing threads becomes a soft-disable (enabled=0,
//     row kept as a tombstone for legacy renderers). Soft-disable counts
//     as an enabled-set change → same invalidation as a hard delete.
//   • Audit log entries for these endpoints land in the G commit.
//
// `sourceTypeid` is exposed on the admin list/get/create payloads
// (per msg bb4aae2a) but the public `/forums/:id/thread-types` continues
// to suppress it (see handlers/forum.ts).

import { withEntityAuth } from "../../lib/adminHelpers";
import {
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpThreadListGen,
} from "../../lib/cache/invalidate";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { parsePathSegment } from "../../lib/parseId";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

// EntityConfig is only used as the auth wrapper key for `withEntityAuth`;
// CRUD here is custom because the table is forum-scoped and delete needs
// soft-disable semantics that the generic factory does not model.
const threadTypeAuthConfig: EntityConfig = {
	table: "forum_thread_types",
	entityName: "FORUM_THREAD_TYPE",
	auth: "admin",
	columns: "*",
	mapper: (r) => r,
};

const MAX_REORDER_ITEMS = 200;
const MAX_NAME_LEN = 100;
const MAX_ICON_LEN = 200;

// ─── Row shape + serializer ───────────────────────────────────────

interface ThreadTypeRow {
	id: number;
	forum_id: number;
	source_typeid: number;
	name: string;
	display_order: number;
	icon: string | null;
	enabled: number;
	moderator_only: number;
}

interface AdminThreadTypeDto {
	id: number;
	forumId: number;
	sourceTypeid: number;
	name: string;
	displayOrder: number;
	icon: string;
	enabled: boolean;
	moderatorOnly: boolean;
}

function rowToDto(r: ThreadTypeRow): AdminThreadTypeDto {
	return {
		id: r.id,
		forumId: r.forum_id,
		sourceTypeid: r.source_typeid,
		name: r.name,
		displayOrder: r.display_order,
		icon: r.icon ?? "",
		enabled: r.enabled === 1,
		moderatorOnly: r.moderator_only === 1,
	};
}

// ─── Validators ───────────────────────────────────────────────────

function isNonNegInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function validateNameField(v: unknown): string | null {
	if (typeof v !== "string" || v.trim().length === 0) return "name is required";
	if (v.length > MAX_NAME_LEN) return `name must be at most ${MAX_NAME_LEN} characters`;
	return null;
}

function validateIconField(v: unknown): string | null {
	if (typeof v !== "string") return "icon must be a string";
	if (v.length > MAX_ICON_LEN) return `icon must be at most ${MAX_ICON_LEN} characters`;
	return null;
}

function validateBoolFlag(v: unknown, field: string): string | null {
	if (typeof v !== "boolean") return `${field} must be a boolean`;
	return null;
}

// ─── Forum gate helpers ───────────────────────────────────────────

interface ForumGateRow {
	id: number;
	thread_types_enabled: number;
	thread_types_required: number;
	thread_types_listable: number;
	thread_types_prefix: number;
}

async function loadForumGate(env: Env, forumId: number): Promise<ForumGateRow | null> {
	return await env.DB.prepare(
		`SELECT id, thread_types_enabled, thread_types_required,
		        thread_types_listable, thread_types_prefix
		 FROM forums WHERE id = ?`,
	)
		.bind(forumId)
		.first<ForumGateRow>();
}

async function loadTypeRow(env: Env, id: number): Promise<ThreadTypeRow | null> {
	return await env.DB.prepare(
		`SELECT id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only
		 FROM forum_thread_types WHERE id = ?`,
	)
		.bind(id)
		.first<ThreadTypeRow>();
}

// ─── List ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/forums/:forumId/thread-types
 *
 * Admin variant: returns ALL rows including tombstones (enabled=0) and
 * exposes `sourceTypeid` (the Discuz-local typeid kept for
 * debug/recovery). Public endpoint stays in handlers/forum.ts and
 * suppresses tombstones + sourceTypeid.
 */
export const list = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const forumId = parsePathSegment(request, 1);
		if (!forumId || forumId <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		const forum = await loadForumGate(env, forumId);
		if (!forum) {
			return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
		}

		const rows = await env.DB.prepare(
			`SELECT id, forum_id, source_typeid, name, display_order, icon, enabled, moderator_only
			 FROM forum_thread_types
			 WHERE forum_id = ?
			 ORDER BY display_order ASC, id ASC`,
		)
			.bind(forumId)
			.all<ThreadTypeRow>();

		return jsonResponse(
			{
				forumId,
				config: {
					enabled: forum.thread_types_enabled === 1,
					required: forum.thread_types_required === 1,
					listable: forum.thread_types_listable === 1,
					prefix: forum.thread_types_prefix === 1,
				},
				types: (rows.results ?? []).map(rowToDto),
			},
			origin,
		);
	},
);

// ─── Create ───────────────────────────────────────────────────────

interface CreateBody {
	name?: unknown;
	displayOrder?: unknown;
	icon?: unknown;
	moderatorOnly?: unknown;
	sourceTypeid?: unknown;
}

/**
 * POST /api/admin/forums/:forumId/thread-types
 * Body: { name, displayOrder?, icon?, moderatorOnly?, sourceTypeid? }
 *
 * Returns the newly created admin DTO with the synthetic id D1 picked.
 * `sourceTypeid` defaults to 0 for admin-created rows (Discuz-local
 * typeids only matter for migrated rows). The (forum_id, source_typeid)
 * UNIQUE INDEX from migration 0039 still applies — we surface a 409
 * with `THREAD_TYPE_DUPLICATE_SOURCE_TYPEID` if the admin tries to
 * pick a non-zero sourceTypeid that collides.
 */
export const create = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const forumId = parsePathSegment(request, 1);
		if (!forumId || forumId <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		let body: CreateBody;
		try {
			body = (await request.json()) as CreateBody;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const nameErr = validateNameField(body.name);
		if (nameErr) return errorResponse("INVALID_BODY", 400, { message: nameErr }, origin);

		const displayOrder = body.displayOrder === undefined ? 0 : body.displayOrder;
		if (!isNonNegInt(displayOrder)) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "displayOrder must be a non-negative integer" },
				origin,
			);
		}

		const icon = body.icon === undefined ? "" : body.icon;
		const iconErr = validateIconField(icon);
		if (iconErr) return errorResponse("INVALID_BODY", 400, { message: iconErr }, origin);

		const moderatorOnly = body.moderatorOnly === undefined ? false : body.moderatorOnly;
		const moderatorOnlyErr = validateBoolFlag(moderatorOnly, "moderatorOnly");
		if (moderatorOnlyErr) {
			return errorResponse("INVALID_BODY", 400, { message: moderatorOnlyErr }, origin);
		}

		const sourceTypeid = body.sourceTypeid === undefined ? 0 : body.sourceTypeid;
		if (!isNonNegInt(sourceTypeid)) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "sourceTypeid must be a non-negative integer" },
				origin,
			);
		}

		const forum = await loadForumGate(env, forumId);
		if (!forum) {
			return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
		}

		// Reject duplicate (forum_id, source_typeid) when sourceTypeid is
		// non-zero. We allow many rows at sourceTypeid=0 (admin-created
		// rows that never had a Discuz origin) — same convention as the
		// migrate path which uses 0 as the placeholder for newly-minted
		// rows on a fresh DB.
		if (sourceTypeid !== 0) {
			const dup = await env.DB.prepare(
				"SELECT id FROM forum_thread_types WHERE forum_id = ? AND source_typeid = ?",
			)
				.bind(forumId, sourceTypeid)
				.first<{ id: number }>();
			if (dup) {
				return errorResponse(
					"THREAD_TYPE_DUPLICATE_SOURCE_TYPEID",
					409,
					{ existingId: dup.id },
					origin,
				);
			}
		}

		const insertRes = await env.DB.prepare(
			`INSERT INTO forum_thread_types
			   (forum_id, source_typeid, name, display_order, icon, enabled, moderator_only)
			 VALUES (?, ?, ?, ?, ?, 1, ?)`,
		)
			.bind(forumId, sourceTypeid, body.name, displayOrder, icon, moderatorOnly ? 1 : 0)
			.run();

		const newId = insertRes.meta?.last_row_id;
		if (!newId || typeof newId !== "number") {
			return errorResponse(
				"INTERNAL_ERROR",
				500,
				{ message: "Failed to create thread type" },
				origin,
			);
		}

		// Same-commit invalidation: enabled-set changed for this forum.
		// forum:tree:v2 carries Forum.threadTypes (config flags); the
		// per-forum thread-list cache is bumped because future payloads
		// may surface the type set / type filter pill.
		await Promise.all([bumpForumTreeGen(env), bumpThreadListGen(env, forumId)]);

		const created = await loadTypeRow(env, newId);
		if (!created) {
			return errorResponse(
				"INTERNAL_ERROR",
				500,
				{ message: "Failed to read back created row" },
				origin,
			);
		}
		return jsonResponse(rowToDto(created), origin, undefined, 201);
	},
);

// ─── Update ───────────────────────────────────────────────────────

interface UpdateBody {
	name?: unknown;
	displayOrder?: unknown;
	icon?: unknown;
	moderatorOnly?: unknown;
	enabled?: unknown;
}

interface UpdateFieldDelta {
	sets: string[];
	binds: unknown[];
	enabledSetChanged: boolean;
	displayOrderOrNameChanged: boolean;
}

interface FieldOutcome {
	column: string;
	bind: unknown;
	enabledSetChanged: boolean;
	displayOrderOrNameChanged: boolean;
}

type FieldHandler = (
	raw: unknown,
	existing: ThreadTypeRow,
) => { errorMessage: string } | { skip: true } | FieldOutcome;

const updateHandlers: Record<keyof UpdateBody, FieldHandler> = {
	name: (raw, existing) => {
		const err = validateNameField(raw);
		if (err) return { errorMessage: err };
		if (raw === existing.name) return { skip: true };
		return {
			column: "name = ?",
			bind: raw,
			enabledSetChanged: false,
			displayOrderOrNameChanged: true,
		};
	},
	displayOrder: (raw, existing) => {
		if (!isNonNegInt(raw)) {
			return { errorMessage: "displayOrder must be a non-negative integer" };
		}
		if (raw === existing.display_order) return { skip: true };
		return {
			column: "display_order = ?",
			bind: raw,
			enabledSetChanged: false,
			displayOrderOrNameChanged: true,
		};
	},
	icon: (raw, existing) => {
		const err = validateIconField(raw);
		if (err) return { errorMessage: err };
		if (raw === (existing.icon ?? "")) return { skip: true };
		return {
			column: "icon = ?",
			bind: raw,
			enabledSetChanged: false,
			displayOrderOrNameChanged: false,
		};
	},
	moderatorOnly: (raw, existing) => {
		const err = validateBoolFlag(raw, "moderatorOnly");
		if (err) return { errorMessage: err };
		const next = raw ? 1 : 0;
		if (next === existing.moderator_only) return { skip: true };
		return {
			column: "moderator_only = ?",
			bind: next,
			enabledSetChanged: false,
			displayOrderOrNameChanged: false,
		};
	},
	enabled: (raw, existing) => {
		const err = validateBoolFlag(raw, "enabled");
		if (err) return { errorMessage: err };
		const next = raw ? 1 : 0;
		if (next === existing.enabled) return { skip: true };
		return {
			column: "enabled = ?",
			bind: next,
			enabledSetChanged: true,
			displayOrderOrNameChanged: false,
		};
	},
};

/**
 * Walk the PATCH body and emit (sets[], binds[]) plus two flags the
 * caller uses to choose the invalidation fan-out. Per-field validation
 * + diff is delegated to the `updateHandlers` table above so this loop
 * stays inside biome's cognitive-complexity budget (max 25).
 */
function collectUpdateFields(
	body: UpdateBody,
	existing: ThreadTypeRow,
): UpdateFieldDelta | { errorMessage: string } {
	const sets: string[] = [];
	const binds: unknown[] = [];
	let enabledSetChanged = false;
	let displayOrderOrNameChanged = false;

	for (const key of Object.keys(updateHandlers) as Array<keyof UpdateBody>) {
		const raw = body[key];
		if (raw === undefined) continue;
		const outcome = updateHandlers[key](raw, existing);
		if ("errorMessage" in outcome) return { errorMessage: outcome.errorMessage };
		if ("skip" in outcome) continue;
		sets.push(outcome.column);
		binds.push(outcome.bind);
		if (outcome.enabledSetChanged) enabledSetChanged = true;
		if (outcome.displayOrderOrNameChanged) displayOrderOrNameChanged = true;
	}

	return { sets, binds, enabledSetChanged, displayOrderOrNameChanged };
}

/**
 * PATCH /api/admin/forum-thread-types/:id
 * Body subset of { name, displayOrder, icon, moderatorOnly, enabled }.
 *
 * Cannot change `forum_id` or `source_typeid` post-create — those are
 * structural identity. To rename across forums, delete + create.
 */
export const update = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const id = parsePathSegment(request, 0);
		if (!id || id <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid id" }, origin);
		}

		let body: UpdateBody;
		try {
			body = (await request.json()) as UpdateBody;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const existing = await loadTypeRow(env, id);
		if (!existing) {
			return errorResponse("THREAD_TYPE_NOT_FOUND", 404, undefined, origin);
		}

		const collected = collectUpdateFields(body, existing);
		if ("errorMessage" in collected) {
			return errorResponse("INVALID_BODY", 400, { message: collected.errorMessage }, origin);
		}
		const { sets, binds, enabledSetChanged, displayOrderOrNameChanged } = collected;

		if (sets.length === 0) {
			// No-op update: still return the row (matches PATCH semantics
			// elsewhere in admin handlers).
			return jsonResponse(rowToDto(existing), origin);
		}

		binds.push(id);
		await env.DB.prepare(`UPDATE forum_thread_types SET ${sets.join(", ")} WHERE id = ?`)
			.bind(...binds)
			.run();

		// Invalidate when anything that affects the public picker changed:
		// enabled set, display order, or display name. Pure icon /
		// moderator_only changes don't need the thread-list bump (filter
		// payload doesn't show them yet) but we still bump tree so the
		// admin tree picker reflects the new icon promptly.
		const ops: Promise<unknown>[] = [bumpForumTreeGen(env)];
		if (enabledSetChanged || displayOrderOrNameChanged) {
			ops.push(bumpThreadListGen(env, existing.forum_id));
		}
		await Promise.all(ops);

		const after = await loadTypeRow(env, id);
		// `after` should never be null here (we just updated by id), but
		// fall back to the pre-update row if D1 throws on the re-read.
		return jsonResponse(rowToDto(after ?? existing), origin);
	},
);

// ─── Delete ───────────────────────────────────────────────────────

/**
 * DELETE /api/admin/forum-thread-types/:id
 *
 * Hard-deletes the row when no thread references it. Otherwise
 * soft-disables (enabled=0) so legacy threads keep their type_name
 * denorm legible — matches the tombstone semantics from migration 0038.
 *
 * Both branches count as an enabled-set change → same invalidation
 * fan-out as create.
 */
export const remove = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const id = parsePathSegment(request, 0);
		if (!id || id <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid id" }, origin);
		}

		const existing = await loadTypeRow(env, id);
		if (!existing) {
			return errorResponse("THREAD_TYPE_NOT_FOUND", 404, undefined, origin);
		}

		const refs = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ? AND type_id = ?",
		)
			.bind(existing.forum_id, id)
			.first<{ cnt: number }>();

		const referenced = (refs?.cnt ?? 0) > 0;

		if (referenced) {
			// Soft-disable preserves the row for type_name resolution but
			// removes it from the picker.
			if (existing.enabled === 1) {
				await env.DB.prepare("UPDATE forum_thread_types SET enabled = 0 WHERE id = ?")
					.bind(id)
					.run();
				await Promise.all([bumpForumTreeGen(env), bumpThreadListGen(env, existing.forum_id)]);
			}
			return jsonResponse(
				{
					deleted: false,
					softDisabled: true,
					id,
					threadCount: refs?.cnt ?? 0,
				},
				origin,
			);
		}

		await env.DB.prepare("DELETE FROM forum_thread_types WHERE id = ?").bind(id).run();
		await Promise.all([bumpForumTreeGen(env), bumpThreadListGen(env, existing.forum_id)]);

		return jsonResponse({ deleted: true, softDisabled: false, id }, origin);
	},
);

// ─── Reorder ──────────────────────────────────────────────────────

interface ReorderItem {
	id: number;
	displayOrder: number;
}

/**
 * PATCH /api/admin/forums/:forumId/thread-types/reorder
 * Body: { orders: [{ id, displayOrder }, ...] }
 *
 * Batches per-row UPDATE statements. Items are validated to belong to
 * `forumId` (a foreign id is rejected, not silently moved) so a typo'd
 * payload cannot reorder another forum's rows.
 */
export const reorder = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const forumId = parsePathSegment(request, 2);
		if (!forumId || forumId <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		let body: { orders?: unknown };
		try {
			body = (await request.json()) as { orders?: unknown };
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
		const items: ReorderItem[] = [];
		for (const it of orders) {
			if (
				typeof it !== "object" ||
				it === null ||
				!isNonNegInt((it as ReorderItem).id) ||
				!isNonNegInt((it as ReorderItem).displayOrder)
			) {
				return errorResponse(
					"INVALID_BODY",
					400,
					{ message: "Each order must have non-negative integer id and displayOrder" },
					origin,
				);
			}
			items.push(it as ReorderItem);
		}

		const ids = items.map((i) => i.id);
		const placeholders = ids.map(() => "?").join(",");
		const owned = await env.DB.prepare(
			`SELECT id, forum_id FROM forum_thread_types WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all<{ id: number; forum_id: number }>();
		const ownedMap = new Map<number, number>((owned.results ?? []).map((r) => [r.id, r.forum_id]));
		for (const id of ids) {
			const ownerForum = ownedMap.get(id);
			if (ownerForum === undefined) {
				return errorResponse("THREAD_TYPE_NOT_FOUND", 404, { id }, origin);
			}
			if (ownerForum !== forumId) {
				return errorResponse("THREAD_TYPE_FORUM_MISMATCH", 400, { id }, origin);
			}
		}

		const stmts = items.map((i) =>
			env.DB.prepare("UPDATE forum_thread_types SET display_order = ? WHERE id = ?").bind(
				i.displayOrder,
				i.id,
			),
		);
		await env.DB.batch(stmts);

		await Promise.all([bumpForumTreeGen(env), bumpThreadListGen(env, forumId)]);

		return jsonResponse({ updated: true, count: items.length }, origin);
	},
);

// ─── 4-switch config ──────────────────────────────────────────────

interface ConfigBody {
	enabled?: unknown;
	required?: unknown;
	listable?: unknown;
	prefix?: unknown;
}

/**
 * PATCH /api/admin/forums/:forumId/thread-types-config
 * Body subset of { enabled, required, listable, prefix } — booleans.
 *
 * Reviewer pin (msg bb4aae2a):
 *   thread_types_required=1 ⇒ thread_types_enabled=1.
 * Computed against the MERGED (existing + incoming) state so an admin
 * can toggle either side without having to re-send the other.
 *
 * Reviewer pin (msg 2935495a):
 *   Switch changes bump forum:tree:gen + forum:summary:gen (the latter
 *   also rolls forum:meta:v2 because meta keys embed `forum:summary:gen`
 *   — see lib/cache/invalidate.ts:bumpForumSummaryGen).
 */
export const updateConfig = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const forumId = parsePathSegment(request, 1);
		if (!forumId || forumId <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		let body: ConfigBody;
		try {
			body = (await request.json()) as ConfigBody;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		// Reject unknown fields early so a typo doesn't silently no-op.
		const allowed = new Set(["enabled", "required", "listable", "prefix"]);
		for (const k of Object.keys(body)) {
			if (!allowed.has(k)) {
				return errorResponse("INVALID_BODY", 400, { message: `Unknown field: ${k}` }, origin);
			}
		}

		const flagFields = [
			["enabled", "thread_types_enabled"],
			["required", "thread_types_required"],
			["listable", "thread_types_listable"],
			["prefix", "thread_types_prefix"],
		] as const;

		for (const [bodyKey] of flagFields) {
			const raw = (body as Record<string, unknown>)[bodyKey];
			if (raw !== undefined && typeof raw !== "boolean") {
				return errorResponse(
					"INVALID_BODY",
					400,
					{ message: `${bodyKey} must be a boolean` },
					origin,
				);
			}
		}

		const forum = await loadForumGate(env, forumId);
		if (!forum) {
			return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
		}

		// Compute the MERGED desired state so the required-needs-enabled
		// invariant catches all bad combos, even when the admin only sends
		// one of the two flags.
		const mergedEnabled =
			body.enabled === undefined ? forum.thread_types_enabled === 1 : body.enabled === true;
		const mergedRequired =
			body.required === undefined ? forum.thread_types_required === 1 : body.required === true;
		if (mergedRequired && !mergedEnabled) {
			return errorResponse(
				"THREAD_TYPE_REQUIRED_NEEDS_ENABLED",
				400,
				{ message: "thread_types_required=1 requires thread_types_enabled=1" },
				origin,
			);
		}

		const sets: string[] = [];
		const binds: unknown[] = [];
		let changed = false;
		for (const [bodyKey, column] of flagFields) {
			const raw = (body as Record<string, unknown>)[bodyKey];
			if (raw === undefined) continue;
			const next = raw ? 1 : 0;
			const current = (forum as unknown as Record<string, number>)[column];
			if (next !== current) {
				sets.push(`${column} = ?`);
				binds.push(next);
				changed = true;
			}
		}

		if (changed) {
			binds.push(forumId);
			await env.DB.prepare(`UPDATE forums SET ${sets.join(", ")} WHERE id = ?`)
				.bind(...binds)
				.run();
			// Forum.threadTypes config lives in forum:tree:v2; meta keys
			// embed `forum:summary:gen` so bumping summary rolls meta too
			// (see comment on bumpForumSummaryGen). The per-forum
			// thread-list bump keeps the typeId-filter cache slice
			// consistent in case the picker just got disabled.
			await Promise.all([
				bumpForumTreeGen(env),
				bumpForumSummaryGen(env),
				bumpThreadListGen(env, forumId),
			]);
		}

		const after = (await loadForumGate(env, forumId)) ?? forum;
		return jsonResponse(
			{
				forumId,
				config: {
					enabled: after.thread_types_enabled === 1,
					required: after.thread_types_required === 1,
					listable: after.thread_types_listable === 1,
					prefix: after.thread_types_prefix === 1,
				},
			},
			origin,
		);
	},
);
