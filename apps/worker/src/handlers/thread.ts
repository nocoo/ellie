// Thread handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import {
	canViewForumVisibility,
	decodeGenericCursor,
	parseIncludeTotal,
	parseThreadCountQuery,
	type Thread,
} from "@ellie/types";
import {
	countLocalThreads,
	getThreadListPage,
	isThreadCursor,
	readGlobalAnnouncements,
	type ThreadCursor,
	type ThreadListMember,
} from "../lib/cache/thread-list-read";
import {
	getThreadRows,
	loadThreadAccess,
	loadThreadAccessBatch,
	projectCurrentThread,
	threadAccessStatus,
	validReadingId,
} from "../lib/cache/thread-loaders";
import { applyCensorFilter } from "../lib/censor";
import { confirmedBatch, confirmedRun } from "../lib/d1-write";
import type { Env } from "../lib/env";
import { ANONYMOUS_AUTHOR_NAME, enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { clampLimit } from "../lib/pagination";
import { parseIdFromPath } from "../lib/parseId";
import { checkPostingPermission } from "../lib/postingPermission";
import { getQueryParam } from "../lib/queryString";
import { jsonListResponse, jsonResponse, paginatedResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { incrementStatsOnThreadCreate } from "../lib/stats-counter";
import { coerceTypeIdInput, resolveAndValidateTypeId } from "../lib/threadType";
import { getUserProfiles } from "../lib/user-cache";
import {
	buildVisibilityContext,
	isForumActive,
	STICKY_GLOBAL,
	STICKY_MODERATED,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Map an `AuthUser | null` (the optionalAuth shape) onto the
 * `ViewerContext | null` used by the toThread/mapThreadRows masking. */
function toViewer(user: { userId: number; role: number } | null): {
	userId: number;
	role: number;
} | null {
	return user ? { userId: user.userId, role: user.role } : null;
}

/** Map D1 rows to Thread objects with optional avatar enrichment.
 *
 * `viewer` gates anonymous masking: rows with `anonymous_author = 1` have
 * authorId/authorName replaced unless viewer is staff or the author; same
 * for `anonymous_last_poster = 1` on lastPoster*. Exported for unit tests;
 * production callers stay within this module. */
export function mapThreadRows(
	results: unknown[],
	useKvCache: boolean,
	viewer: { userId: number; role: number } | null,
): Thread[] {
	// Inline toThread + avatar fan-out into one allocation per row — avoids
	// a function call and a 4-field post-creation mutation when JOIN data is
	// present. Property order matches toThread() so V8 can keep a single
	// hidden class for both call sites.
	const isStaff = viewer !== null && (viewer.role === 1 || viewer.role === 2 || viewer.role === 3);
	const viewerId = viewer?.userId ?? 0;
	const n = results.length;
	const out = new Array<Thread>(n);
	for (let i = 0; i < n; i++) {
		out[i] = mapOneThreadRow(results[i] as D1ThreadRowLike, useKvCache, isStaff, viewerId);
	}
	return out;
}

/** Per-row mapper extracted so {@link mapThreadRows} stays under the
 * cognitive-complexity ceiling. Inlined call site keeps the V8 hidden-class
 * shape stable. */
function mapOneThreadRow(
	r: D1ThreadRowLike,
	useKvCache: boolean,
	isStaff: boolean,
	viewerId: number,
): Thread {
	const anonAuthor = r.anonymous_author === 1 ? 1 : 0;
	const anonLast = r.anonymous_last_poster === 1 ? 1 : 0;
	const showAuthor = anonAuthor === 0 || isStaff || viewerId === r.author_id;
	const lastPosterId = r.last_poster_id ?? 0;
	const showLast = anonLast === 0 || isStaff || viewerId === lastPosterId;

	// Avatar resolution diverges between fast paths but the masked-author
	// branch always blanks them out. Resolve both pairs once.
	const authorAvatar =
		useKvCache || !showAuthor ? "" : ((r.author_avatar as string | undefined) ?? "");
	const authorAvatarPath =
		useKvCache || !showAuthor ? "" : ((r.author_avatar_path as string | undefined) ?? "");
	const lastPosterAvatar =
		useKvCache || !showLast ? "" : ((r.last_poster_avatar as string | undefined) ?? "");
	const lastPosterAvatarPath =
		useKvCache || !showLast ? "" : ((r.last_poster_avatar_path as string | undefined) ?? "");

	return {
		id: r.id,
		forumId: r.forum_id,
		authorId: showAuthor ? r.author_id : 0,
		authorName: showAuthor ? r.author_name : ANONYMOUS_AUTHOR_NAME,
		authorAvatar,
		authorAvatarPath,
		subject: r.subject,
		createdAt: r.created_at,
		lastPostAt: r.last_post_at,
		lastPoster: showLast ? r.last_poster : ANONYMOUS_AUTHOR_NAME,
		lastPosterId: showLast ? lastPosterId : 0,
		lastPosterAvatar,
		lastPosterAvatarPath,
		replies: r.replies,
		views: r.views,
		closed: r.closed,
		sticky: r.sticky,
		digest: r.digest,
		special: r.special,
		highlight: r.highlight,
		recommends: r.recommends,
		typeName: r.type_name,
		anonymousAuthor: anonAuthor,
		anonymousLastPoster: anonLast,
		isAuthorFirstThread: false, // Retired display flag; retained for API compatibility.
		// List views do not surface the recommended-card flag — it is only
		// read by the thread-detail mod menu. Default false so the Thread
		// type stays uniform without paying for a per-row EXISTS probe in
		// forum/profile lists.
		isRecommended: false,
	};
}

// Local row shape (mirrors D1ThreadRow used by mappers.toThread). Kept inline
// to avoid an extra import surface; the runtime cast is identical.
interface D1ThreadRowLike {
	id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	subject: string;
	created_at: number;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number | null;
	replies: number;
	views: number;
	closed: number;
	sticky: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	type_name: string;
	anonymous_author?: number;
	anonymous_last_poster?: number;
	author_avatar?: string;
	author_avatar_path?: string;
	last_poster_avatar?: string;
	last_poster_avatar_path?: string;
	is_author_first_thread?: number;
}

function openThreadList(request: Request):
	| Response
	| {
			origin: string | undefined;
			rawUrl: string;
			forumId: number;
			cursorStr: string | null;
			pageParam: string | null;
			limit: number;
			page: number;
			typeInput: ReturnType<typeof coerceTypeIdInput>;
	  } {
	const origin = request.headers.get("Origin") ?? undefined;
	const rawUrl = request.url;
	const forumIdParam = getQueryParam(rawUrl, "forumId");
	if (!forumIdParam)
		return errorResponse("INVALID_REQUEST", 400, { message: "forumId is required" }, origin);
	const forumId = Number.parseInt(forumIdParam, 10);
	if (!validReadingId(forumId))
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forumId" }, origin);
	const cursorStr = getQueryParam(rawUrl, "cursor");
	const pageParam = getQueryParam(rawUrl, "page");
	const limit = clampLimit(getQueryParam(rawUrl, "limit"), { defaultLimit: 100, maxLimit: 100 });
	const page = pageParam && !cursorStr ? Math.max(1, Number.parseInt(pageParam, 10) || 1) : 1;
	if (
		!Number.isSafeInteger(limit) ||
		!Number.isSafeInteger(page) ||
		!Number.isSafeInteger((page - 1) * limit)
	) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid pagination" }, origin);
	}
	const typeInput = coerceTypeIdInput(getQueryParam(rawUrl, "typeId"));
	if (typeInput.kind === "invalid")
		return errorResponse("INVALID_REQUEST", 400, { message: typeInput.message }, origin);
	if (typeInput.kind === "ok" && !Number.isSafeInteger(typeInput.value)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid typeId" }, origin);
	}
	return { origin, rawUrl, forumId, cursorStr, pageParam, limit, page, typeInput };
}

/** GET /api/v1/threads - All legal keyset/offset pages share reusable entities. */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const opened = openThreadList(request);
	if (opened instanceof Response) return opened;
	const { origin, rawUrl, forumId, cursorStr, pageParam, limit, page, typeInput } = opened;

	// The gate is current even when forum or membership snapshots are warm.
	const [user, forum] = await Promise.all([
		optionalAuthVerified(request, env),
		env.DB.prepare("SELECT status, visibility, thread_types_enabled FROM forums WHERE id = ?")
			.bind(forumId)
			.first<{ status: number; visibility: string; thread_types_enabled: number }>(),
	]);
	if (!isForumActive(forum)) return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	if (!canViewForumVisibility(forum.visibility as ForumVisibility, buildVisibilityContext(user))) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}
	const type =
		typeInput.kind === "ok"
			? await resolveAndValidateTypeId(env, forumId, typeInput.value, {
					enabled: forum.thread_types_enabled === 1,
				})
			: ({ kind: "noTypeRequested" } as const);
	const includeParsed = parseIncludeTotal(getQueryParam(rawUrl, "includeTotal"));
	if (!includeParsed.ok) {
		return errorResponse("INVALID_REQUEST", 400, { message: includeParsed.message }, origin);
	}
	const wantsOffset = Boolean(pageParam) && !cursorStr;
	if (
		type.kind === "invalid" &&
		wantsOffset &&
		!includeParsed.value &&
		(type.reason === "notFound" || type.reason === "forumDisabled")
	) {
		return jsonResponse([], origin, { page, limit, hasNext: false });
	}
	if (type.kind === "invalid")
		return errorResponse("INVALID_REQUEST", 400, { message: type.message }, origin);
	const typeId = type.kind === "ok" ? type.row.id : null;
	const cursor = cursorStr ? decodeGenericCursor<ThreadCursor>(cursorStr, isThreadCursor) : null;
	const includeTotal = wantsOffset && includeParsed.value;
	const query = { forumId, limit, page, cursor, typeId, includeTotal };
	const eligible = typeId === null ? await eligibleGlobalAnnouncements(env, ctx, user) : undefined;
	let pageData = await getThreadListPage(env, ctx, query, false, eligible);
	const membership = pageData.window ?? pageData.items;
	let access = await loadThreadAccessBatch(
		env,
		membership.map((item) => item.id),
	);
	const allowed = (id: number) => memberVisible(access.get(id), user, forumId, typeId);
	if (membership.some((item) => !allowed(item.id))) {
		pageData = await getThreadListPage(env, ctx, query, true, eligible);
		access = await loadThreadAccessBatch(
			env,
			(pageData.window ?? pageData.items).map((item) => item.id),
		);
	}
	const visible = (pageData.window ?? pageData.items).filter((item) => allowed(item.id));
	const ids = visible.slice(0, limit).map((item) => item.id);
	const hasNext = visible.length > limit;
	const rows = await getThreadRows(env, ctx, ids);
	const projected = ids.flatMap((id) => {
		const row = rows.get(id);
		const current = access.get(id);
		return row && current ? [projectCurrentThread(row, current)] : [];
	});
	// Generic list projection masks anonymous authors and last posters for every viewer.
	const items = await enrichThreadsWithUserCacheFromList(
		mapThreadRows(projected, true, null),
		env,
		ctx,
	);
	if (includeTotal) {
		if (pageData.total === null) throw new Error("Missing page total");
		return paginatedResponse(items, pageData.total, page, limit, origin);
	}
	if (wantsOffset) return jsonResponse(items, origin, { page, limit, hasNext });
	return jsonListResponse(items, origin, pageData.nextCursor);
}

/** GET /api/v1/threads/count — same composition as the offset page total. */
export async function count(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const parsed = parseThreadCountQuery(new URL(request.url).searchParams);
	if (!parsed.ok) return errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin);
	const { forumId } = parsed.value;
	const [user, forum] = await Promise.all([
		optionalAuthVerified(request, env),
		env.DB.prepare("SELECT status, visibility, thread_types_enabled FROM forums WHERE id = ?")
			.bind(forumId)
			.first<{ status: number; visibility: string; thread_types_enabled: number }>(),
	]);
	if (!isForumActive(forum)) return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	if (!canViewForumVisibility(forum.visibility as ForumVisibility, buildVisibilityContext(user))) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}
	let typeId: number | null = null;
	if (parsed.value.typeId !== undefined) {
		const type = await resolveAndValidateTypeId(env, forumId, parsed.value.typeId, {
			enabled: forum.thread_types_enabled === 1,
		});
		if (type.kind === "invalid") {
			if (type.reason === "notFound" || type.reason === "forumDisabled") {
				return jsonResponse({ total: 0 }, origin);
			}
			return errorResponse("INVALID_REQUEST", 400, { message: type.message }, origin);
		}
		typeId = type.kind === "ok" ? type.row.id : null;
	}
	const local = await countLocalThreads(env, forumId, typeId);
	const globals = typeId === null ? (await eligibleGlobalAnnouncements(env, _ctx, user)).length : 0;
	return jsonResponse({ total: local + globals }, origin);
}

function memberVisible(
	row:
		| (Awaited<ReturnType<typeof loadThreadAccessBatch>> extends Map<number, infer T> ? T : never)
		| undefined,
	user: Awaited<ReturnType<typeof optionalAuthVerified>>,
	forumId: number,
	typeId: number | null,
): boolean {
	if (!row || row.sticky < 0 || threadAccessStatus(row, user) !== null) return false;
	if (
		row.sticky === STICKY_GLOBAL &&
		!canViewForumVisibility(row.visibility as ForumVisibility, buildVisibilityContext(user))
	) {
		return false;
	}
	return typeId === null
		? row.forum_id === forumId || row.sticky === STICKY_GLOBAL
		: row.forum_id === forumId && row.type_id === typeId;
}

async function eligibleGlobalAnnouncements(
	env: Env,
	ctx: ExecutionContext,
	user: Awaited<ReturnType<typeof optionalAuthVerified>>,
): Promise<ThreadListMember[]> {
	const snapshot = await readGlobalAnnouncements(env, ctx);
	if (!snapshot.items.length) return [];
	const access = await loadThreadAccessBatch(
		env,
		snapshot.items.map((item) => item.id),
	);
	const viewer = buildVisibilityContext(user);
	return snapshot.items.filter((item) => {
		const row = access.get(item.id);
		return (
			!!row &&
			row.status === 1 &&
			row.sticky === STICKY_GLOBAL &&
			canViewForumVisibility(row.visibility as ForumVisibility, viewer)
		);
	});
}

/** Helper to enrich threads with user cache (only used when KV cache is enabled) */
async function enrichThreadsWithUserCacheFromList(
	threads: Thread[],
	env: Env,
	ctx: ExecutionContext,
): Promise<Thread[]> {
	// Collect all user IDs (authors and last posters)
	const userIds = new Set<number>();
	for (const thread of threads) {
		if (thread.authorId > 0) userIds.add(thread.authorId);
		if (thread.lastPosterId > 0) userIds.add(thread.lastPosterId);
	}
	if (userIds.size === 0) return threads;

	const userCache = await getUserProfiles(env, ctx, [...userIds]);
	return enrichThreadsWithUserCache(threads, userCache);
}

/** GET /api/v1/threads/:id - Pure data loads plus one explicit reading event. */
export async function getById(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (!validReadingId(id)) return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	const [user, access] = await Promise.all([
		optionalAuthVerified(request, env),
		loadThreadAccess(env, id),
	]);
	const status = threadAccessStatus(access, user);
	if (status === 404 || !access) return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	if (status === 403)
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this thread" },
			origin,
		);
	const row = (await getThreadRows(env, ctx, [id])).get(id);
	if (!row) return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	let thread = toThread(projectCurrentThread(row, access), toViewer(user));
	if (access.sticky === STICKY_MODERATED) thread.moderationStatus = "pending_review";
	thread = (await enrichThreadsWithUserCacheFromList([thread], env, ctx))[0] ?? thread;
	return jsonResponse(thread, origin);
}

/** POST /api/v1/threads - Create a new thread (requires auth) */
export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check posting permission (banned, muted, registration days, avatar, content switch)
	const permissionResult = await checkPostingPermission(env, user, origin, "thread");
	if (!permissionResult.allowed) {
		return permissionResult.error;
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const forumId = typeof body.forumId === "number" ? body.forumId : undefined;
	const subject = typeof body.subject === "string" ? body.subject : undefined;
	let content = typeof body.content === "string" ? body.content : undefined;

	if (typeof forumId !== "number" || Number.isNaN(forumId)) {
		return errorResponse("INVALID_BODY", 400, { message: "forumId is required (number)" }, origin);
	}
	if (!subject || subject.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "subject is required" }, origin);
	}
	if (subject.length > 200) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "subject must be at most 200 characters" },
			origin,
		);
	}
	if (!content || content.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	// Pre-parse `typeId` BEFORE censor / DB hits — a malformed typeId is a
	// caller bug we can reject without spending any further resources.
	// `coerceTypeIdInput` short-circuits null/undefined/"" to "absent" so
	// older clients that omit typeId remain unaffected.
	const typeIdParse = coerceTypeIdInput(body.typeId);
	if (typeIdParse.kind === "invalid") {
		return errorResponse("INVALID_BODY", 400, { message: typeIdParse.message }, origin);
	}
	const typeIdInput = typeIdParse.kind === "ok" ? typeIdParse.value : null;

	// Censor word check — subject + content (independent, run in parallel)
	const [subjectCheck, contentCheck] = await Promise.all([
		applyCensorFilter(subject.trim(), env),
		applyCensorFilter(content.trim(), env),
	]);
	if (subjectCheck.banned || contentCheck.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	const filteredSubject = subjectCheck.content;
	content = contentCheck.content;

	// Forum visibility query + author-name lookup are independent of each
	// other and of the censor checks above — fire both in parallel.
	// SELECT widened with `thread_types_enabled` / `thread_types_required`
	// so we can validate `body.typeId` without an extra D1 hit (the create
	// path doesn't go through the cached forum:meta:v2 reader).
	const [forum, authorRow] = await Promise.all([
		env.DB.prepare(
			"SELECT id, status, visibility, thread_types_enabled, thread_types_required FROM forums WHERE id = ?",
		)
			.bind(forumId)
			.first<{
				id: number;
				status: number;
				visibility: string;
				thread_types_enabled: number;
				thread_types_required: number;
			}>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (!isForumActive(forum)) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	// Check if user can post to this forum (visibility check)
	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(forum.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to post in this forum" },
			origin,
		);
	}

	// Resolve typeId against the forum gate. Reuses the same
	// `resolveAndValidateTypeId` helper as the GET filter (msg b4221d27)
	// so that "disabled forum / cross-forum / tombstoned row / not in this
	// forum" all surface identical 4xx semantics.
	//
	// `forum.thread_types_required = 1` adds one extra rule on top of the
	// resolver: a missing typeId is a 400 (forum requires picking a
	// category before posting). The resolver itself doesn't enforce
	// "required" because the list-filter path treats absent typeId as
	// "no filter" — we only check it here on create.
	const typeResolution = await resolveAndValidateTypeId(env, forumId, typeIdInput, {
		enabled: forum.thread_types_enabled === 1,
	});
	if (typeResolution.kind === "invalid") {
		return errorResponse("INVALID_BODY", 400, { message: typeResolution.message }, origin);
	}
	if (
		typeResolution.kind === "noTypeRequested" &&
		forum.thread_types_enabled === 1 &&
		forum.thread_types_required === 1
	) {
		return errorResponse("INVALID_BODY", 400, { message: "Forum requires a thread type" }, origin);
	}
	// Reviewer pin (msg 4f1464c8): denorm columns must be `0 / ""` when no
	// type is selected — never NULL. The synthetic id stays the same as
	// the value we wrote on import.
	const insertTypeId = typeResolution.kind === "ok" ? typeResolution.row.id : 0;
	const insertTypeName = typeResolution.kind === "ok" ? typeResolution.row.name : "";

	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Step 1: Insert thread (with last_poster_id for user cache)
	const threadResult = await confirmedRun(
		env.DB.prepare(
			"INSERT INTO threads (forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest, type_id, type_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)",
		).bind(
			forumId,
			user.userId,
			authorName,
			filteredSubject,
			now,
			now,
			authorName,
			user.userId,
			insertTypeId,
			insertTypeName,
		),
	);
	const threadId = threadResult.meta.last_row_id;

	// Step 2: batch the post insert + count updates, while concurrently
	// fetching the just-inserted thread row. The thread row was already
	// committed by Step 1, so the SELECT can run alongside the batch —
	// shaving one D1 round-trip off the create-thread response time.
	const [, createdThread] = await Promise.all([
		confirmedBatch(env, [
			env.DB.prepare(
				"INSERT INTO posts (thread_id, forum_id, author_id, author_name, content, created_at, is_first, position) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
			).bind(threadId, forumId, user.userId, authorName, content, now),
			env.DB.prepare(
				"UPDATE forums SET threads = threads + 1, posts = posts + 1, last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?",
			).bind(threadId, now, authorName, user.userId, filteredSubject, forumId),
			env.DB.prepare("UPDATE users SET threads = threads + 1, posts = posts + 1 WHERE id = ?").bind(
				user.userId,
			),
		]),
		env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first(),
	]);
	// Ordinary creation leaves SHORT list/summary snapshots alive. The
	// submitter receives the committed entity directly below.
	await incrementStatsOnThreadCreate(env).catch((error) =>
		console.warn("[thread:create] stats counter increment failed", error),
	);

	return jsonResponse(
		toThread(createdThread as Record<string, unknown>, {
			userId: user.userId,
			role: user.role,
		}),
		origin,
		undefined,
		201,
	);
});
