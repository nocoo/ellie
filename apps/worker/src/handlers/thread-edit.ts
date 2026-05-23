// Thread metadata edit handlers — Key A + JWT, unified author / moderator path.
//
// Endpoint: PATCH /api/v1/threads/:id
//   body: { subject: string }
//
// Both thread authors and forum moderators converge on this one handler.
// Permission is enforced via canEditThreadSubject (@ellie/types):
//   - Moderators (Admin / SuperMod / Mod-in-scope): always allowed, even on
//     closed threads.
//   - Active authors: allowed only when the thread is not closed.
// The admin console has its own PATCH /api/admin/threads/:id (admin/thread.ts)
// that supports more fields + admin_logs audit. This endpoint is deliberately
// narrower — subject only — so we do NOT emit admin_logs rows from user/mod
// surfaces here. See reviewer freeze msg=a8ee78db.

import { canEditThreadSubject } from "@ellie/types";
import { bumpForumSummaryGen, bumpThreadListGen, bumpThreadMetaGen } from "../lib/cache/invalidate";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { parseIdFromPath } from "../lib/parseId";
import { getForumForPermission, getUserForPermission } from "../lib/permissionHelpers";
import { jsonResponse } from "../lib/response";
import { requireVerifiedEmail } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

const SUBJECT_MAX = 200;

// ─── PATCH /api/v1/threads/:id ───────────────────────────────────

export async function editThreadSubject(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Auth: verified email + active status (banned users blocked upstream).
	const authResult = await requireVerifiedEmail(request, env);
	if (authResult instanceof Response) return authResult;
	const { user: authUser } = authResult;

	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	// Strict body: only `subject` is honored. Extra fields are rejected so
	// future field additions can't slip through unchecked and so client code
	// cannot accidentally edit unrelated columns by including them.
	const { subject } = body;
	if (typeof subject !== "string") {
		return errorResponse("INVALID_BODY", 400, { message: "subject must be a string" }, origin);
	}
	const extraKeys = Object.keys(body).filter((k) => k !== "subject");
	if (extraKeys.length > 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `Unexpected fields: ${extraKeys.join(", ")}` },
			origin,
		);
	}

	const trimmed = subject.trim();
	if (trimmed.length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "subject cannot be empty" }, origin);
	}
	if (trimmed.length > SUBJECT_MAX) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `subject must be at most ${SUBJECT_MAX} characters` },
			origin,
		);
	}

	// Fetch thread (need authorId + forumId + closed + current subject) and
	// the permission-shaped user/forum rows in parallel. User row could be
	// stale vs `authUser.role` — `getUserForPermission` is the source of
	// truth for `canModerate`.
	const thread = await env.DB.prepare(
		"SELECT id, forum_id, author_id, closed, subject FROM threads WHERE id = ?",
	)
		.bind(id)
		.first<{
			id: number;
			forum_id: number;
			author_id: number;
			closed: number;
			subject: string;
		}>();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const [permUser, permForum] = await Promise.all([
		getUserForPermission(env, authUser.userId),
		getForumForPermission(env, thread.forum_id),
	]);
	if (!permUser || !permForum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	const allowed = canEditThreadSubject(
		permUser,
		{ id: thread.id, authorId: thread.author_id, closed: thread.closed },
		permForum,
	);
	if (!allowed) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to edit this thread's title" },
			origin,
		);
	}

	// Censor filter — banned terms reject, otherwise the filtered text is
	// stored (mirrors thread creation in handlers/thread.ts).
	const censor = await applyCensorFilter(trimmed, env);
	if (censor.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	const finalSubject = censor.content;

	// Semantic no-op: nothing changed after censor + trim. Return 200 OK
	// without bumping any cache gen — invalidations on no-ops are pure
	// overhead and would mask hot caches with cold reads.
	if (finalSubject === thread.subject) {
		return jsonResponse({ id, updated: false }, origin);
	}

	await env.DB.prepare("UPDATE threads SET subject = ? WHERE id = ?").bind(finalSubject, id).run();

	// Cache invalidation matrix:
	//   - thread:meta:gen:<id>   — thread detail caches that include subject
	//   - thread:list:gen:<fid>  — per-forum thread list snippets show subject
	//   - forum:summary:gen      — `forum:summary:v2.lastThreadSubject` may
	//                              reflect this thread when it's the visible
	//                              last thread of its forum.
	// All three are independent KV bumps — fan out in parallel.
	await Promise.all([
		bumpThreadMetaGen(env, id),
		bumpThreadListGen(env, thread.forum_id),
		bumpForumSummaryGen(env),
	]);

	return jsonResponse({ id, updated: true }, origin);
}
