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
//   • G — every write path emits an `admin_logs` entry via writeAdminLog
//     after the mutation succeeds. Actions:
//       thread_type.create      / target=forum_thread_type
//       thread_type.update      / target=forum_thread_type (with diff)
//       thread_type.delete      / target=forum_thread_type (mode + mutated)
//       thread_type.reorder     / target=forum   (orderedIds)
//       thread_type.config      / target=forum   (changedFlags + before/after)
//     Payload always carries `forumId` + (when row-scoped) `threadTypeId`
//     and `sourceTypeid`, so audit consumers can join back without a row
//     re-read. updateConfig / soft-disable also log no-op calls with
//     `mutated:false` so the admin's intent is recorded even when the
//     handler short-circuits.
//
// `sourceTypeid` is exposed on the admin list/get/create payloads
// (per msg bb4aae2a) but the public `/forums/:id/thread-types` continues
// to suppress it (see handlers/forum.ts).

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpThreadListGen,
} from "../../lib/cache/invalidate";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { parsePathSegment } from "../../lib/parseId";
import { jsonNoStoreResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";
import { invalidateThreadTypesCache } from "../forum";

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

		return jsonNoStoreResponse(
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
 * Build the audit payload for `thread_type.create`. Pulled out of the
 * handler so the create flow stays under biome's cognitive complexity
 * cap. Mirrors the row's post-rewrite state — `sourceTypeid` is the
 * synthetic id for default-create, the supplied number otherwise.
 */
function buildCreateAuditDetails(forumId: number, created: ThreadTypeRow): Record<string, unknown> {
	return {
		forumId,
		threadTypeId: created.id,
		sourceTypeid: created.source_typeid,
		name: created.name,
		displayOrder: created.display_order,
		moderatorOnly: created.moderator_only === 1,
		iconLength: created.icon ? created.icon.length : 0,
	};
}

/**
 * POST /api/admin/forums/:forumId/thread-types
 * Body: { name, displayOrder?, icon?, moderatorOnly?, sourceTypeid? }
 *
 * Returns the newly created admin DTO with the synthetic id D1 picked.
 * `sourceTypeid` defaults to 0 in the request body (admins working
 * through the web UI don't set it). Internally we two-step write so
 * the row's persisted `source_typeid` ends up equal to the synthetic
 * `id` — see comment block at the placeholder-rewrite below for the
 * full rationale and the reviewer pin (msg fefddfcc, P0). The (forum_id,
 * source_typeid) UNIQUE INDEX from migration 0039 is the natural key,
 * and reusing the synthetic id keeps it unique without a sequence
 * allocator.
 *
 * If the admin explicitly passes a non-zero `sourceTypeid` (e.g. during
 * a manual backfill that mirrors a Discuz local id), we surface a 409
 * with `THREAD_TYPE_DUPLICATE_SOURCE_TYPEID` if it collides.
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

		// Reviewer pin (msg fefddfcc, P2): reject unknown fields so a
		// typo doesn't silently no-op. The allow-list mirrors CreateBody.
		const allowedCreate = new Set([
			"name",
			"displayOrder",
			"icon",
			"moderatorOnly",
			"sourceTypeid",
		]);
		for (const k of Object.keys(body as Record<string, unknown>)) {
			if (!allowedCreate.has(k)) {
				return errorResponse("INVALID_BODY", 400, { message: `Unknown field: ${k}` }, origin);
			}
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
		// non-zero. The 0039 UNIQUE INDEX `(forum_id, source_typeid)` is
		// authoritative — admins explicitly setting a non-zero sourceTypeid
		// (e.g. typing back the Discuz local id during a backfill) must
		// not collide.
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

		// Reviewer pin (msg fefddfcc, P0):
		// `(forum_id, source_typeid)` is UNIQUE (migration 0039). The
		// previous draft assumed many rows at source_typeid=0 per forum
		// were OK — they are NOT; the second admin-created row in the
		// same forum would crash with `UNIQUE constraint failed`.
		//
		// Two-step write for admin-created rows (sourceTypeid = 0):
		//   1. INSERT with placeholder source_typeid=0 to get the
		//      synthetic id D1 mints (last_row_id).
		//   2. UPDATE source_typeid = newId immediately so the natural
		//      key is unique forever after. The synthetic id is itself
		//      globally unique, so reusing it as source_typeid keeps the
		//      (forum_id, source_typeid) pair unique without any clever
		//      sequence allocator.
		// Migrated rows always carry the real Discuz typeid in
		// source_typeid, never 0 (forumfield typeid=0 is filtered out
		// upstream — see 0039 header), so the placeholder-0 transient
		// row in step 1 cannot collide with a migrated row.
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

		// Step 2 of the placeholder-0 dance: rewrite source_typeid to the
		// synthetic id so the (forum_id, source_typeid) pair stays unique
		// across future inserts.
		if (sourceTypeid === 0) {
			await env.DB.prepare("UPDATE forum_thread_types SET source_typeid = ? WHERE id = ?")
				.bind(newId, newId)
				.run();
		}

		// Same-commit invalidation: enabled-set changed for this forum.
		// forum:tree:v2 carries Forum.threadTypes (config flags); the
		// per-forum thread-list cache is bumped because future payloads
		// may surface the type set / type filter pill. Also invalidate
		// the public thread-types KV cache.
		await Promise.all([
			bumpForumTreeGen(env),
			bumpThreadListGen(env, forumId),
			invalidateThreadTypesCache(env, forumId),
		]);

		const created = await loadTypeRow(env, newId);
		if (!created) {
			return errorResponse(
				"INTERNAL_ERROR",
				500,
				{ message: "Failed to read back created row" },
				origin,
			);
		}

		// Audit: F-G — audit only after the mutation succeeded (writeAdminLog
		// is best-effort and never throws). `sourceTypeid` reflects the
		// post-rewrite value (newId for default-create; the supplied number
		// otherwise) so audit consumers see the row's true natural key.
		await writeAdminLog(env, resolveActor(request, env), {
			action: "thread_type.create",
			targetType: "forum_thread_type",
			targetId: newId,
			details: buildCreateAuditDetails(forumId, created),
		});

		return jsonNoStoreResponse(rowToDto(created), origin, undefined, 201);
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

		// Reviewer pin (msg fefddfcc, P2): reject unknown fields. Of
		// note, `sourceTypeid` is intentionally NOT in this allow-list —
		// we never want a PATCH to silently drop a stray sourceTypeid;
		// the structural identity is set at create time and not editable.
		const allowedUpdate = new Set(["name", "displayOrder", "icon", "moderatorOnly", "enabled"]);
		for (const k of Object.keys(body as Record<string, unknown>)) {
			if (!allowedUpdate.has(k)) {
				return errorResponse("INVALID_BODY", 400, { message: `Unknown field: ${k}` }, origin);
			}
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
			return jsonNoStoreResponse(rowToDto(existing), origin);
		}

		binds.push(id);
		await env.DB.prepare(`UPDATE forum_thread_types SET ${sets.join(", ")} WHERE id = ?`)
			.bind(...binds)
			.run();

		// Invalidate when anything that affects the public picker changed:
		// enabled set, display order, or display name. Pure icon /
		// moderator_only changes don't need the thread-list bump (filter
		// payload doesn't show them yet) but we still bump tree so the
		// admin tree picker reflects the new icon promptly. Also invalidate
		// the public thread-types KV cache.
		const ops: Promise<unknown>[] = [
			bumpForumTreeGen(env),
			invalidateThreadTypesCache(env, existing.forum_id),
		];
		if (enabledSetChanged || displayOrderOrNameChanged) {
			ops.push(bumpThreadListGen(env, existing.forum_id));
		}
		await Promise.all(ops);

		const after = await loadTypeRow(env, id);
		// `after` should never be null here (we just updated by id), but
		// fall back to the pre-update row if D1 throws on the re-read.
		const finalRow = after ?? existing;

		// Audit: record the field-level diff so consumers can see what
		// each PATCH actually changed without re-reading both row versions.
		const changedFields: string[] = [];
		const before: Record<string, unknown> = {};
		const afterDiff: Record<string, unknown> = {};
		if (existing.name !== finalRow.name) {
			changedFields.push("name");
			before.name = existing.name;
			afterDiff.name = finalRow.name;
		}
		if (existing.display_order !== finalRow.display_order) {
			changedFields.push("displayOrder");
			before.displayOrder = existing.display_order;
			afterDiff.displayOrder = finalRow.display_order;
		}
		if ((existing.icon ?? "") !== (finalRow.icon ?? "")) {
			changedFields.push("icon");
			before.iconLength = (existing.icon ?? "").length;
			afterDiff.iconLength = (finalRow.icon ?? "").length;
		}
		if (existing.moderator_only !== finalRow.moderator_only) {
			changedFields.push("moderatorOnly");
			before.moderatorOnly = existing.moderator_only === 1;
			afterDiff.moderatorOnly = finalRow.moderator_only === 1;
		}
		if (existing.enabled !== finalRow.enabled) {
			changedFields.push("enabled");
			before.enabled = existing.enabled === 1;
			afterDiff.enabled = finalRow.enabled === 1;
		}
		await writeAdminLog(env, resolveActor(request, env), {
			action: "thread_type.update",
			targetType: "forum_thread_type",
			targetId: id,
			details: {
				forumId: existing.forum_id,
				threadTypeId: id,
				sourceTypeid: existing.source_typeid,
				changedFields,
				before,
				after: afterDiff,
			},
		});

		return jsonNoStoreResponse(rowToDto(finalRow), origin);
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
			const wasEnabled = existing.enabled === 1;
			if (wasEnabled) {
				await env.DB.prepare("UPDATE forum_thread_types SET enabled = 0 WHERE id = ?")
					.bind(id)
					.run();
				await Promise.all([
					bumpForumTreeGen(env),
					bumpThreadListGen(env, existing.forum_id),
					invalidateThreadTypesCache(env, existing.forum_id),
				]);
			}
			// Audit even the no-op case (already-disabled with refs) so the
			// admin's intent is recorded; `mutated` distinguishes the two.
			await writeAdminLog(env, resolveActor(request, env), {
				action: "thread_type.delete",
				targetType: "forum_thread_type",
				targetId: id,
				details: {
					forumId: existing.forum_id,
					threadTypeId: id,
					sourceTypeid: existing.source_typeid,
					name: existing.name,
					mode: "soft_disable",
					mutated: wasEnabled,
					threadCount: refs?.cnt ?? 0,
				},
			});
			return jsonNoStoreResponse(
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
		await Promise.all([
			bumpForumTreeGen(env),
			bumpThreadListGen(env, existing.forum_id),
			invalidateThreadTypesCache(env, existing.forum_id),
		]);

		await writeAdminLog(env, resolveActor(request, env), {
			action: "thread_type.delete",
			targetType: "forum_thread_type",
			targetId: id,
			details: {
				forumId: existing.forum_id,
				threadTypeId: id,
				sourceTypeid: existing.source_typeid,
				name: existing.name,
				mode: "hard_delete",
				mutated: true,
				threadCount: 0,
			},
		});

		return jsonNoStoreResponse({ deleted: true, softDisabled: false, id }, origin);
	},
);

// ─── Reorder ──────────────────────────────────────────────────────

/**
 * PATCH /api/admin/forums/:forumId/thread-types/reorder
 * Body: { ids: [n, n, ...] }
 *
 * Reviewer pin (msg fefddfcc, P1 + earlier 4b64ac64):
 *   The payload is the COMPLETE ordered set of ids for this forum.
 *   We reject any partial / extra / duplicate / cross-forum list and
 *   rewrite `display_order = i` for the i-th id in the array. This
 *   is the only way to keep the order space dense (0..N-1, no holes,
 *   no ties) and to prevent a UI that only submitted a partial drag
 *   from leaving the picker in an unpredictable state.
 */
export const reorder = withEntityAuth(
	threadTypeAuthConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const forumId = parsePathSegment(request, 2);
		if (!forumId || forumId <= 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
		}

		let body: { ids?: unknown };
		try {
			body = (await request.json()) as { ids?: unknown };
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		const ids = body.ids;
		if (!Array.isArray(ids) || ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (ids.length > MAX_REORDER_ITEMS) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_REORDER_ITEMS} items per batch` },
				origin,
			);
		}
		// Validate each entry is a positive integer; reject duplicates.
		const seen = new Set<number>();
		for (const v of ids) {
			if (!isNonNegInt(v) || v <= 0) {
				return errorResponse(
					"INVALID_BODY",
					400,
					{ message: "Each id must be a positive integer" },
					origin,
				);
			}
			if (seen.has(v)) {
				return errorResponse("INVALID_BODY", 400, { message: `Duplicate id: ${v}` }, origin);
			}
			seen.add(v);
		}
		const orderedIds = ids as number[];

		// Pull the canonical id set for this forum and require the
		// request to match it EXACTLY (no missing, no extra). Partial
		// reorder is rejected so display_order stays dense.
		const owned = await env.DB.prepare("SELECT id FROM forum_thread_types WHERE forum_id = ?")
			.bind(forumId)
			.all<{ id: number }>();
		const ownedSet = new Set<number>((owned.results ?? []).map((r) => r.id));

		if (orderedIds.length !== ownedSet.size) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{
					message: `ids must include every thread type in this forum (got ${orderedIds.length}, expected ${ownedSet.size})`,
				},
				origin,
			);
		}
		for (const id of orderedIds) {
			if (!ownedSet.has(id)) {
				// Either id doesn't exist at all OR it lives in another
				// forum — either way the reorder isn't well-formed for
				// this forum.
				return errorResponse("THREAD_TYPE_FORUM_MISMATCH", 400, { id }, origin);
			}
		}

		// Dense rewrite: display_order = array index.
		const stmts = orderedIds.map((id, idx) =>
			env.DB.prepare("UPDATE forum_thread_types SET display_order = ? WHERE id = ?").bind(idx, id),
		);
		await env.DB.batch(stmts);

		await Promise.all([
			bumpForumTreeGen(env),
			bumpThreadListGen(env, forumId),
			invalidateThreadTypesCache(env, forumId),
		]);

		await writeAdminLog(env, resolveActor(request, env), {
			action: "thread_type.reorder",
			targetType: "forum",
			targetId: forumId,
			details: {
				forumId,
				count: orderedIds.length,
				orderedIds,
			},
		});

		return jsonNoStoreResponse({ updated: true, count: orderedIds.length }, origin);
	},
);

// ─── 4-switch config ──────────────────────────────────────────────

interface ConfigBody {
	enabled?: unknown;
	required?: unknown;
	listable?: unknown;
	prefix?: unknown;
}

interface ForumGateLike {
	thread_types_enabled: number;
	thread_types_required: number;
	thread_types_listable: number;
	thread_types_prefix: number;
}

/**
 * Materialize the 4-switch audit diff from before / after forum gate
 * snapshots. Pulled out of the handler so updateConfig stays under
 * biome's cognitive complexity cap.
 */
function diffForumConfig(
	before: ForumGateLike,
	after: ForumGateLike,
): {
	beforeCfg: { enabled: boolean; required: boolean; listable: boolean; prefix: boolean };
	afterCfg: { enabled: boolean; required: boolean; listable: boolean; prefix: boolean };
	changedFlags: string[];
} {
	const beforeCfg = {
		enabled: before.thread_types_enabled === 1,
		required: before.thread_types_required === 1,
		listable: before.thread_types_listable === 1,
		prefix: before.thread_types_prefix === 1,
	};
	const afterCfg = {
		enabled: after.thread_types_enabled === 1,
		required: after.thread_types_required === 1,
		listable: after.thread_types_listable === 1,
		prefix: after.thread_types_prefix === 1,
	};
	const changedFlags: string[] = [];
	for (const k of ["enabled", "required", "listable", "prefix"] as const) {
		if (beforeCfg[k] !== afterCfg[k]) changedFlags.push(k);
	}
	return { beforeCfg, afterCfg, changedFlags };
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
			// consistent in case the picker just got disabled. Also
			// invalidate the public thread-types KV cache.
			await Promise.all([
				bumpForumTreeGen(env),
				bumpForumSummaryGen(env),
				bumpThreadListGen(env, forumId),
				invalidateThreadTypesCache(env, forumId),
			]);
		}

		const after = (await loadForumGate(env, forumId)) ?? forum;

		// Audit even no-op calls so we can see who tried to flip what.
		// `mutated` distinguishes the noop from a real write.
		const { beforeCfg, afterCfg, changedFlags } = diffForumConfig(forum, after);
		await writeAdminLog(env, resolveActor(request, env), {
			action: "thread_type.config",
			targetType: "forum",
			targetId: forumId,
			details: {
				forumId,
				mutated: changed,
				changedFlags,
				before: beforeCfg,
				after: afterCfg,
			},
		});

		return jsonNoStoreResponse(
			{
				forumId,
				config: afterCfg,
			},
			origin,
		);
	},
);
