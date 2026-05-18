// Post rating (评分) handlers for Cloudflare Worker.
//
// Phase 2 (docs/22-post-rating.md §6.2): create-rating endpoint only.
// GET ratings / revoke endpoints land in Phase 3.

import {
	type CreatePostRatingResponse,
	EMPTY_RATING_AGGREGATE,
	type PostRatingAggregate,
	type PostRatingRow,
	RATING_QUOTA_WINDOW_SECONDS,
	RATING_REASON_MAX_LENGTH,
	RatingDimension,
	type RatingDimensionKey,
	type UserRole,
	canRateDimension,
	canRevokeRating,
	canViewForumVisibility,
	getRatingPerDayCap,
	getRatingPerVoteBounds,
	ratingDimensionToKey,
	ratingKeyToDimension,
} from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { buildVisibilityContext, isForumActive } from "../lib/visibility";
import { errorResponse } from "../middleware/error";

// ─── Constants ──────────────────────────────────────────────

/** Subject line of the auto-generated PM when notifyAuthor=true. */
const RATING_PM_SUBJECT = "您收到一条评分";

/**
 * D1 unique-constraint error pattern. SQLite surfaces partial-unique-index
 * violations through this substring; matches `SqliteError: UNIQUE
 * constraint failed: ...` and `Error: D1_ERROR: UNIQUE constraint failed`.
 */
const UNIQUE_ERROR_RE = /UNIQUE\s+constraint\s+failed/i;

// ─── Helpers ────────────────────────────────────────────────

/**
 * Strip BBCode-style tags `[b]...[/b]` and HTML tags so the reason becomes
 * plain text. Used by both the public list (post_ratings.reason column)
 * and the PM body so the rater can't smuggle markup through the bridge.
 */
function stripMarkup(input: string): string {
	return input
		.replace(/\[\/?[a-zA-Z][a-zA-Z0-9]*(?:=[^\]]*)?\]/g, "") // BBCode-ish tags
		.replace(/<[^>]+>/g, "") // HTML tags
		.replace(/[\r\n\t]+/g, " "); // collapse whitespace to a space
}

/**
 * Reason processing pipeline (docs/22 §6.2 — PM 字段与正文模板):
 *   trim → censor → strip markup → length check.
 *
 * Returns either the cleaned plain-text reason or an error response. The
 * same value is stored in `post_ratings.reason` AND embedded in the PM
 * body, so the public list and the PM cannot diverge.
 */
async function processReason(
	raw: unknown,
	env: Env,
	origin: string | undefined,
): Promise<{ ok: true; reason: string } | { ok: false; response: Response }> {
	const reasonRaw = typeof raw === "string" ? raw : "";
	const trimmed = reasonRaw.trim();
	if (trimmed.length === 0) {
		return { ok: true, reason: "" };
	}

	const censor = await applyCensorFilter(trimmed, env);
	if (censor.banned) {
		return { ok: false, response: errorResponse("CONTENT_BANNED", 403, undefined, origin) };
	}

	const plain = stripMarkup(censor.content).trim();

	if (plain.length > RATING_REASON_MAX_LENGTH) {
		return {
			ok: false,
			response: errorResponse(
				"RATING_REASON_TOO_LONG",
				400,
				{ message: `reason must be at most ${RATING_REASON_MAX_LENGTH} characters` },
				origin,
			),
		};
	}

	return { ok: true, reason: plain };
}

/** Render the canonical PM body. Server-decided so raters cannot inject content. */
function buildRatingPmBody(opts: {
	raterName: string;
	threadSubject: string;
	dimension: RatingDimension;
	score: number;
	reasonPlain: string;
	postUrl: string;
}): string {
	const label = opts.dimension === RatingDimension.Credits ? "积分" : "同钱";
	const signed = opts.score >= 0 ? `+${opts.score}` : String(opts.score);
	const reasonLine = opts.reasonPlain.length > 0 ? opts.reasonPlain : "（无）";
	return [
		`@${opts.raterName} 对您的回帖评分：`,
		`【${opts.threadSubject}】`,
		`${label} ${signed}`,
		`理由：${reasonLine}`,
		opts.postUrl,
	].join("\n");
}

/**
 * Build the public URL fragment that appears in the PM body. The web
 * BFF maps `/thread/:id#post-:id` to the canonical permalink; we keep
 * it as a relative path here since the Worker doesn't know the deployed
 * web origin.
 */
function buildPostUrl(threadId: number, postId: number): string {
	return `/thread/${threadId}#post-${postId}`;
}

/** Compute the per-dimension aggregate for a single post (active rows only). */
async function loadAggregate(env: Env, postId: number): Promise<PostRatingAggregate> {
	const row = await env.DB.prepare(
		`SELECT
			COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN dimension = 1 THEN 1 ELSE 0 END), 0) AS credits_count,
			COALESCE(SUM(CASE WHEN dimension = 1 THEN score ELSE 0 END), 0) AS credits_sum,
			COALESCE(SUM(CASE WHEN dimension = 2 THEN 1 ELSE 0 END), 0) AS coins_count,
			COALESCE(SUM(CASE WHEN dimension = 2 THEN score ELSE 0 END), 0) AS coins_sum
		 FROM post_ratings
		 WHERE post_id = ? AND revoked_at = 0`,
	)
		.bind(postId)
		.first<{
			total: number;
			credits_count: number;
			credits_sum: number;
			coins_count: number;
			coins_sum: number;
		}>();

	if (!row) return { ...EMPTY_RATING_AGGREGATE };
	return {
		total: row.total,
		credits: { count: row.credits_count, sum: row.credits_sum },
		coins: { count: row.coins_count, sum: row.coins_sum },
	};
}

/** Map an inserted D1 row back to the JSON wire shape. */
function toPostRatingRow(
	row: {
		id: number;
		post_id: number;
		thread_id: number;
		rater_id: number;
		rater_name: string;
		dimension: number;
		score: number;
		reason: string;
		created_at: number;
		revoked_at: number;
	},
	viewerRole: UserRole | null,
): PostRatingRow {
	const dimensionEnum = (row.dimension as RatingDimension) ?? RatingDimension.Coins;
	return {
		id: row.id,
		postId: row.post_id,
		threadId: row.thread_id,
		raterId: row.rater_id,
		raterName: row.rater_name,
		dimension: ratingDimensionToKey(dimensionEnum),
		score: row.score,
		reason: row.reason,
		createdAt: row.created_at,
		revokedAt: row.revoked_at,
		canRevoke: row.revoked_at === 0 && viewerRole !== null && canRevokeRating(viewerRole),
	};
}

// ─── POST /api/v1/posts/:postId/rate ────────────────────────

interface ParsedRateBody {
	dimension: RatingDimension;
	dimensionKey: RatingDimensionKey;
	score: number;
	absScore: number;
	notifyAuthor: boolean;
}

/**
 * Parse + validate the request payload (path postId + JSON body fields).
 * Returns the parsed shape or an early error response. Pulled out of
 * {@link createRating} so the main handler stays under the cognitive
 * complexity threshold.
 */
function parseRateBodyAndPath(
	request: Request,
	body: Record<string, unknown>,
	origin: string | undefined,
): { postId: number; parsed: ParsedRateBody } | Response {
	const url = new URL(request.url);
	const match = url.pathname.match(/^\/api\/v1\/posts\/(\d+)\/rate$/);
	if (!match) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid path" }, origin);
	}
	const postId = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(postId) || postId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid postId" }, origin);
	}

	const dimensionKey = body.dimension;
	if (dimensionKey !== "credits" && dimensionKey !== "coins") {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "dimension must be 'credits' or 'coins'" },
			origin,
		);
	}
	const dimension = ratingKeyToDimension(dimensionKey);

	const scoreRaw = body.score;
	if (typeof scoreRaw !== "number" || !Number.isFinite(scoreRaw) || !Number.isInteger(scoreRaw)) {
		return errorResponse("INVALID_BODY", 400, { message: "score must be an integer" }, origin);
	}

	const bounds = getRatingPerVoteBounds(dimension);
	const absScore = Math.abs(scoreRaw);
	if (absScore < bounds.min || absScore > bounds.max) {
		return errorResponse(
			"RATING_SCORE_OUT_OF_RANGE",
			400,
			{
				message: `|score| must be in [${bounds.min}, ${bounds.max}]`,
				min: bounds.min,
				max: bounds.max,
			},
			origin,
		);
	}

	return {
		postId,
		parsed: {
			dimension,
			dimensionKey,
			score: scoreRaw,
			absScore,
			notifyAuthor: body.notifyAuthor === true,
		},
	};
}

interface PostChainRow {
	post_id: number;
	thread_id: number;
	author_id: number;
	author_name: string;
	invisible: number;
	thread_subject: string;
	sticky: number;
	forum_id: number;
	forum_status: number;
	forum_visibility: string;
}

/**
 * Visibility / self / invisible / forum-active gate. Returns null when
 * the caller is allowed to proceed; otherwise an error response. Mirrors
 * the precedence baked into docs/22 §3 (RATING_INVALID_POST > RATING_SELF
 * > forum 404 > forum 403).
 */
function rejectPostChain(
	postRow: PostChainRow,
	user: { userId: number; role: number },
	origin: string | undefined,
): Response | null {
	if (postRow.invisible !== 0 || postRow.author_id === 0) {
		return errorResponse("RATING_INVALID_POST", 403, undefined, origin);
	}
	if (postRow.author_id === user.userId) {
		return errorResponse("RATING_SELF", 403, undefined, origin);
	}
	if (postRow.sticky < 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}
	if (!isForumActive({ status: postRow.forum_status })) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}
	const visCtx = buildVisibilityContext(user);
	if (!canViewForumVisibility(postRow.forum_visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}
	return null;
}

/**
 * Build the (insert, update, optional PM) batch statements. Kept separate
 * from the orchestrator so the SQL stays close to the spec and the main
 * handler doesn't carry the cognitive load.
 */
function buildBatchStatements(
	env: Env,
	args: {
		postId: number;
		postRow: PostChainRow;
		user: { userId: number; role: number };
		raterName: string;
		parsed: ParsedRateBody;
		reasonPlain: string;
		now: number;
		windowStart: number;
		perDayCap: number;
	},
): D1PreparedStatement[] {
	const { postId, postRow, user, raterName, parsed, reasonPlain, now, windowStart, perDayCap } =
		args;
	const dimensionInt = parsed.dimension;
	const userColumn = parsed.dimensionKey; // users.credits | users.coins

	const insertRating = env.DB.prepare(
		`INSERT INTO post_ratings
			(post_id, thread_id, rater_id, rater_name, dimension, score, reason, created_at, revoked_at, revoked_by)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0
		 WHERE (
			SELECT COALESCE(SUM(ABS(score)), 0)
			FROM post_ratings
			WHERE rater_id = ?
			  AND dimension = ?
			  AND revoked_at = 0
			  AND created_at >= ?
		 ) + ? <= ?`,
	).bind(
		postId,
		postRow.thread_id,
		user.userId,
		raterName,
		dimensionInt,
		parsed.score,
		reasonPlain,
		now,
		user.userId,
		dimensionInt,
		windowStart,
		parsed.absScore,
		perDayCap,
	);

	const updateAuthor = env.DB.prepare(
		`UPDATE users
		 SET ${userColumn} = ${userColumn} + ?
		 WHERE id = ?
		   AND EXISTS (
			SELECT 1 FROM post_ratings
			WHERE rater_id = ? AND post_id = ? AND dimension = ?
			  AND created_at = ? AND revoked_at = 0
		 )`,
	).bind(parsed.score, postRow.author_id, user.userId, postId, dimensionInt, now);

	const statements: D1PreparedStatement[] = [insertRating, updateAuthor];

	if (parsed.notifyAuthor) {
		const pmBody = buildRatingPmBody({
			raterName,
			threadSubject: postRow.thread_subject,
			dimension: parsed.dimension,
			score: parsed.score,
			reasonPlain,
			postUrl: buildPostUrl(postRow.thread_id, postId),
		});

		statements.push(
			env.DB.prepare(
				`INSERT INTO messages
					(sender_id, sender_name, receiver_id, receiver_name,
					 subject, content, is_read, sender_deleted, receiver_deleted, created_at)
				 SELECT ?, ?, ?, ?, ?, ?, 0, 0, 0, ?
				 WHERE EXISTS (
					SELECT 1 FROM post_ratings
					WHERE rater_id = ? AND post_id = ? AND dimension = ?
					  AND created_at = ? AND revoked_at = 0
				 )`,
			).bind(
				user.userId,
				raterName,
				postRow.author_id,
				postRow.author_name,
				RATING_PM_SUBJECT,
				pmBody,
				now,
				user.userId,
				postId,
				parsed.dimension,
				now,
			),
		);
	}

	return statements;
}

/**
 * Create a rating event. Implements the guarded-D1-batch flow from
 * docs/22 §6.2:
 *   1. Permission + score-range guards (app layer).
 *   2. Conditional INSERT — rolling-24h quota check lives inside the
 *      SQL so a concurrent submit can't double-spend the cap.
 *   3. Author credits/coins UPDATE guarded by `WHERE EXISTS (... revoked_at=0)`
 *      pointed at the row we just tried to insert (matched on rater + post +
 *      dim + created_at).
 *   4. Optional PM INSERT guarded by the same EXISTS subquery so the
 *      author isn't pinged when the quota guard caused the rating insert
 *      to no-op.
 *   5. After batch returns, inspect `meta.changes` on the rating insert
 *      to decide 200 vs 429. UNIQUE-index violation → 409.
 */
export const create = withVerifiedEmail((request, env, user) => createRating(request, env, user));

async function createRating(
	request: Request,
	env: Env,
	user: { userId: number; role: number },
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const parseResult = parseRateBodyAndPath(request, body, origin);
	if (parseResult instanceof Response) return parseResult;
	const { postId, parsed } = parseResult;

	// Reason pipeline (trim → censor → strip → length).
	const reasonResult = await processReason(body.reason, env, origin);
	if (!reasonResult.ok) return reasonResult.response;
	const reasonPlain = reasonResult.reason;

	if (!canRateDimension(user.role as UserRole, parsed.dimension)) {
		return errorResponse(
			"RATING_PERMISSION_DENIED",
			403,
			{ message: `Role cannot rate dimension '${parsed.dimensionKey}'` },
			origin,
		);
	}

	const [postRow, raterRow] = await Promise.all([
		env.DB.prepare(
			`SELECT
				p.id            AS post_id,
				p.thread_id     AS thread_id,
				p.author_id     AS author_id,
				p.author_name   AS author_name,
				p.invisible     AS invisible,
				t.subject       AS thread_subject,
				t.sticky        AS sticky,
				t.forum_id      AS forum_id,
				f.status        AS forum_status,
				f.visibility    AS forum_visibility
			 FROM posts p
			 JOIN threads t ON t.id = p.thread_id
			 JOIN forums  f ON f.id = t.forum_id
			 WHERE p.id = ?`,
		)
			.bind(postId)
			.first<PostChainRow>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (!postRow) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const gate = rejectPostChain(postRow, user, origin);
	if (gate) return gate;

	const raterName = raterRow?.username ?? `user_${user.userId}`;
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - RATING_QUOTA_WINDOW_SECONDS;
	const perDayCap = getRatingPerDayCap(user.role as UserRole, parsed.dimension);

	// Defensive: getRatingPerDayCap returns 0 for roles without permission,
	// which canRateDimension above should already have caught — but if a
	// future role gets added that's permitted-but-uncapped we want a clear
	// 429 instead of an unbounded write.
	if (perDayCap <= 0) {
		return errorResponse(
			"RATING_DAILY_LIMIT",
			429,
			{ message: "No daily quota configured for this role" },
			origin,
		);
	}

	const statements = buildBatchStatements(env, {
		postId,
		postRow,
		user,
		raterName,
		parsed,
		reasonPlain,
		now,
		windowStart,
		perDayCap,
	});

	let batchResults: D1Result[];
	try {
		batchResults = (await env.DB.batch(statements)) as D1Result[];
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (UNIQUE_ERROR_RE.test(message)) {
			return errorResponse(
				"RATING_DUPLICATE",
				409,
				{ message: "You have already rated this post in this dimension" },
				origin,
			);
		}
		throw err;
	}

	const ratingInsertMeta = batchResults[0]?.meta as
		| { changes?: number; last_row_id?: number }
		| undefined;
	if (!ratingInsertMeta || (ratingInsertMeta.changes ?? 0) === 0) {
		return errorResponse(
			"RATING_DAILY_LIMIT",
			429,
			{ message: "Daily rating quota exhausted for this dimension" },
			origin,
		);
	}

	const ratingId = ratingInsertMeta.last_row_id ?? 0;

	const created: PostRatingRow = toPostRatingRow(
		{
			id: ratingId,
			post_id: postId,
			thread_id: postRow.thread_id,
			rater_id: user.userId,
			rater_name: raterName,
			dimension: parsed.dimension,
			score: parsed.score,
			reason: reasonPlain,
			created_at: now,
			revoked_at: 0,
		},
		user.role as UserRole,
	);

	const aggregate = await loadAggregate(env, postId);

	const payload: CreatePostRatingResponse = { rating: created, aggregate };
	return jsonResponse(payload, origin, undefined, 201);
}
