import type { Forum, ForumVisibility, ModeratorInfo } from "@ellie/types";
import { canModerate, parseSummaryGateQuery } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import { getCachedThreadTypes } from "../lib/cache/catalog-read";
import type { ForumTreeNodeV2 } from "../lib/cache/forum";
import {
	currentForums,
	getForumMetaV2,
	getForumSummaryV2,
	getForums,
	getForumTreeV2,
	loadSummaryGates,
	toForumSummaries,
} from "../lib/cache/forum-read";
import { invalidateForumUpdateV2 } from "../lib/cache/invalidate";
import { dataCacheKey } from "../lib/cache/keys";
import { cacheDelete } from "../lib/cache/wrap";
import type { Env } from "../lib/env";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { getForumForPermission, getUserForPermission } from "../lib/permissionHelpers";
import { jsonResponse } from "../lib/response";
import { prepareAnnouncement } from "../lib/sanitizeAnnouncement";
import { buildVisibilityContext, canViewForumVisibility } from "../lib/visibility";
import { moderationMiddleware, optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Exact deletion fences any active fill in this isolate. */
export async function invalidateThreadTypesCache(env: Env, forumId: number): Promise<void> {
	await Promise.all([
		cacheDelete(env, `thread-types:${forumId}`, "thread-types"),
		cacheDelete(
			env,
			await dataCacheKey("admin:thread-types", { forumId }, "admin"),
			"admin:thread-types",
		),
	]);
}

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	const user = await optionalAuthVerified(request, env);
	const bucket = computeVisibilityBucket(buildVisibilityContext(user));
	const view = new URL(request.url).searchParams.get("view");
	if (view === "names") {
		const nodes = await getForumTreeV2(env, ctx, bucket);
		return jsonResponse(
			nodes.map(({ id, name }) => ({ id, name })),
			origin,
		);
	}
	if (view === "structure") {
		const nodes = await getForumTreeV2(env, ctx, bucket);
		return jsonResponse(nodes.map(structureForum), origin, { bucket });
	}
	return jsonResponse(await getForums(env, ctx, bucket), origin);
}

const EMPTY_THREAD_TYPES = {
	enabled: false,
	required: false,
	listable: false,
	prefix: false,
};

/** Static forum row. Numeric and latest-topic fields stay zero so this read never loads summaries. */
function structureForum(node: ForumTreeNodeV2): Forum {
	return {
		id: node.id,
		parentId: node.parentId,
		name: node.name,
		description: node.description,
		announcement: node.announcement,
		icon: node.icon,
		displayOrder: node.displayOrder,
		type: node.type,
		status: node.status,
		visibility: node.visibility,
		moderators: node.moderators,
		moderatorList: node.moderatorList,
		threads: 0,
		posts: 0,
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: node.threadTypes ?? EMPTY_THREAD_TYPES,
	};
}

/** GET /api/v1/forums/summaries — D1 numeric and latest-topic rows for the caller. */
export async function summaries(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const user = await optionalAuthVerified(request, env);
	const bucket = computeVisibilityBucket(buildVisibilityContext(user));
	const aggregates = await getForumSummaryV2(env, ctx, bucket);
	return jsonResponse(toForumSummaries(aggregates), origin, { bucket });
}

/** GET /api/v1/forums/summary-gates — current authorization rows, no titles. */
export async function summaryGates(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const parsed = parseSummaryGateQuery(new URL(request.url).searchParams);
	if (!parsed.ok) return errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin);
	const user = await optionalAuthVerified(request, env);
	const bucket = computeVisibilityBucket(buildVisibilityContext(user));
	return jsonResponse(await loadSummaryGates(env, parsed.value.topicIds, bucket), origin);
}

/** GET /api/v1/forums/:id - Get forum by ID */
export async function getById(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request) ?? Number.NaN;

	// Current permissions precede structural/counter snapshot composition.
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);

	const result = await getForumMetaV2(env, ctx, id, bucket);

	if (result.kind === "notFound") {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (result.kind === "forbidden") {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}
	return jsonResponse(result.forum, origin);
}

// ─── Ancestors endpoint ─────────────────────────────────────────────

/** Forum context returned by ancestors endpoint (structural fields only). */
interface ForumContext {
	id: number;
	parentId: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
	type: string;
	moderators: string;
	moderatorIds: string;
	moderatorList: ModeratorInfo[];
}

/** Breadcrumb item returned by ancestors endpoint. */
interface AncestorItem {
	id: number;
	parentId: number;
	name: string;
}

/**
 * GET /api/v1/forums/:id/ancestors
 *
 * Lightweight breadcrumb endpoint. Returns the target forum's context plus its
 * ancestor chain (root → parent), computed from the v2 KV-cached forum tree
 * which is already pre-filtered to active + visible nodes for the bucket.
 * Hidden parents are absent from the tree, so the ancestor chain naturally
 * terminates at the first hidden link.
 */
export async function getAncestors(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Parse forum ID from path: /api/v1/forums/:id/ancestors
	const forumId = parsePathSegment(request, 1);
	if (!forumId || forumId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Get optional user auth for visibility filtering
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);
	const checked = await currentForums(env, forumId);
	const visibleNodes = await getForumTreeV2(env, ctx, bucket, undefined, checked);

	const target = visibleNodes.find((n) => n.id === forumId);
	if (!target) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	const byId = new Map<number, (typeof visibleNodes)[number]>();
	for (const n of visibleNodes) byId.set(n.id, n);

	const ancestors: AncestorItem[] = [];
	let current = byId.get(target.parentId);
	const visited = new Set<number>([target.id]);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		ancestors.push({ id: current.id, parentId: current.parentId, name: current.name });
		if (current.parentId === 0 || current.parentId === current.id) break;
		current = byId.get(current.parentId);
	}
	ancestors.reverse();

	const forumContext: ForumContext = {
		id: target.id,
		parentId: target.parentId,
		name: target.name,
		status: target.status,
		visibility: target.visibility,
		type: target.type,
		moderators: target.moderators,
		moderatorIds: target.moderatorIds,
		moderatorList: target.moderatorList,
	};
	return jsonResponse({ forum: forumContext, ancestors }, origin);
}

// ─── Thread types endpoint ──────────────────────────────────────────

/**
 * Public thread-types payload for one forum.
 *
 *   • config flags mirror `forums.thread_types_*` — match Forum.threadTypes
 *     so callers that already have the Forum DTO can drop a redundant fetch.
 *   • `types` — only **enabled** rows from `forum_thread_types`. Tombstones
 *     (enabled=0) are intentionally excluded; they are render-only via the
 *     thread.type_name denorm column. Admin/debug endpoints get the full
 *     row set including source_typeid.
 *
 * Reviewer pin (msg b03d4af3 #1, #5): `id` is the synthetic global id, the
 * Discuz-local source_typeid is admin-only and not surfaced here.
 *
 * Reviewer pin (msg 07f1ad4e P1): rows are emitted as the shared
 * `ForumThreadType` DTO (id, name, displayOrder, icon, enabled,
 * moderatorOnly). The public endpoint only ever returns enabled rows so
 * `enabled` is structurally redundant on the wire — kept to match the
 * shared shape and to give #9 / future moderator UI room without a DTO
 * change.
 */
/** Read the current forum gate before serving the reusable picker snapshot. */
export async function getThreadTypes(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const forumId = parsePathSegment(request, 1);
	if (!forumId || forumId <= 0)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	const user = await optionalAuthVerified(request, env);
	const forum = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(forumId)
		.first<{ status: number; visibility: ForumVisibility }>();
	if (forum?.status !== 1) return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	if (!canViewForumVisibility(forum.visibility, buildVisibilityContext(user)))
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	const payload = await getCachedThreadTypes(env, ctx, forumId);
	return payload
		? jsonResponse(payload, origin)
		: errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
}

// ─── PATCH /api/v1/forums/:id/announcement ────────────────────────
//
// Updates the public-facing forum announcement (the "本版规则" card
// at the top of a forum's thread list). Permission model:
//   1. `moderationMiddleware` — role ∈ {Admin, SuperMod, Mod} + not banned
//      + email verified (matches sticky / digest / close endpoints).
//   2. `canModerate(user, forum)` — Admin/SuperMod always pass; Mod must
//      have their username in `forum.moderators` (per-forum scope).
//
// Body: `{ announcement: string }` (4 KiB max post-sanitize). Empty
// string clears the announcement. The Worker is the security boundary —
// the Web UI hides the edit button for non-moderators but that is UX
// polish only; this endpoint is the only gate that matters.
//
// Cache invalidation: announcement is a non-digest-affecting field, so
// we use `invalidateForumUpdateV2(env, { affectsDigest: false })` which
// bumps tree + summary gens but not digest gen.
export async function setAnnouncement(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const forumId = parsePathSegment(request, 1);
	if (forumId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const prepared = prepareAnnouncement(body.announcement);
	if (!prepared.ok) {
		if (prepared.code === "INVALID_TYPE") {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "announcement must be a string" },
				origin,
			);
		}
		if (prepared.code === "TOO_LONG") {
			return errorResponse(
				"PAYLOAD_TOO_LARGE",
				400,
				{ message: "announcement exceeds 4 KiB after sanitize" },
				origin,
			);
		}
	}

	// `prepared.ok === true` from here on. Fetch user + forum for the
	// per-forum permission check. Both queries are required and run in
	// parallel — a Mod's scope is determined by `forum.moderators`.
	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, forumId),
	]);

	if (!forum) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (!user) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	if (!canModerate(user, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to moderate this forum" },
			origin,
		);
	}

	// `prepared.html` is the sanitized payload that will live in D1.
	// Length is already capped to 4 KiB UTF-8 by `prepareAnnouncement`.
	const written = await env.DB.prepare("UPDATE forums SET announcement = ? WHERE id = ?")
		.bind(prepared.html ?? "", forumId)
		.run();
	if (!written.success) throw new Error("Forum announcement write was not confirmed");

	await invalidateForumUpdateV2(env, { affectsDigest: false });

	return jsonResponse({ id: forumId, announcement: prepared.html ?? "" }, origin);
}
