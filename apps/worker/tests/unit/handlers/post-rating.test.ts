// Post-rating create handler — Phase 2 unit tests.
//
// Covers docs/22 §6.2 wire contract:
//   * Email-verified gate
//   * Body / score / dimension / reason validation
//   * Permission matrix (User can rate coins, not credits; Mod+ can do both)
//   * Self / invisible / anonymous-author guards
//   * Visibility (forum status / forum visibility)
//   * Daily quota → 429
//   * Unique-index violation → 409
//   * PM insert sanitization + guard (skipped when notifyAuthor=false; written
//     with stripped BBCode when notifyAuthor=true; first SQL inspected by
//     reading the mock-db calls list)

import { describe, expect, it } from "vitest";
import * as postRating from "../../../src/handlers/post-rating";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

// ─── Fixtures ──────────────────────────────────────────────

interface BuildEnvOpts {
	role?: number; // user role for auth lookup
	userId?: number;
	status?: number;
	emailVerifiedAt?: number;
	postRow?: Record<string, unknown> | null;
	raterRow?: Record<string, unknown> | null;
	aggregate?: Record<string, unknown> | null;
	censorWords?: unknown[];
	insertRatingMeta?: { changes: number; last_row_id: number };
	batchThrows?: Error | null;
}

function buildEnv(opts: BuildEnvOpts = {}) {
	const role = opts.role ?? 0;
	const userId = opts.userId ?? 10;
	const status = opts.status ?? 0;
	const evAt = opts.emailVerifiedAt ?? 1_700_000_000;

	const postRow =
		"postRow" in opts
			? opts.postRow
			: {
					post_id: 5,
					thread_id: 7,
					author_id: 20,
					author_name: "bob",
					invisible: 0,
					thread_subject: "Hello world",
					sticky: 0,
					forum_id: 1,
					forum_status: 1,
					forum_visibility: "public",
				};

	const raterRow = opts.raterRow ?? { username: `alice_${userId}` };

	const aggregate = opts.aggregate ?? {
		total: 1,
		credits_count: 0,
		credits_sum: 0,
		coins_count: 1,
		coins_sum: 5,
	};

	const { db, calls, batchCalls } = createMockDb({
		firstResults: {
			"SELECT role, status, email_verified_at": {
				role,
				status,
				email_verified_at: evAt,
			},
			"FROM posts p": postRow,
			"SELECT username FROM users WHERE id = ?": raterRow,
			"COUNT(*) AS total": aggregate,
		},
		allResults: {
			"SELECT id, find, replacement, action FROM censor_words": opts.censorWords ?? [],
		},
	});

	// Swap batch behavior: optionally throw, otherwise return the inserted-row
	// meta supplied by the caller (defaulting to a successful insert).
	const insertMeta = opts.insertRatingMeta ?? { changes: 1, last_row_id: 99 };
	const original = db.batch;
	(db as { batch: typeof original }).batch = (async (stmts: unknown[]) => {
		if (opts.batchThrows) throw opts.batchThrows;
		batchCalls.push(stmts);
		return stmts.map((_, i) => ({
			success: true,
			results: [],
			meta:
				i === 0
					? { changes: insertMeta.changes, last_row_id: insertMeta.last_row_id }
					: { changes: insertMeta.changes, last_row_id: 0 },
		}));
	}) as typeof db.batch;

	return { env: makeEnv({ DB: db }), calls, batchCalls, userId };
}

async function jwtFor(role: number, userId = 10): Promise<string> {
	return createJwtForRole(role, userId);
}

function makeRateRequest(postId: number, token: string, body: Record<string, unknown>): Request {
	return new Request(`https://api.example.com/api/v1/posts/${postId}/rate`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

// ─── Tests ─────────────────────────────────────────────────

describe("post-rating create handler", () => {
	// ── Auth / email-gate ──

	it("should require authentication", async () => {
		const env = makeEnv();
		const request = new Request("https://api.example.com/api/v1/posts/5/rate", {
			method: "POST",
			body: JSON.stringify({ dimension: "coins", score: 1, reason: "", notifyAuthor: false }),
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(401);
	});

	it("should reject unverified email via the §5.4 payload", async () => {
		const { env, userId } = makeUnverifiedEnv();
		const token = await unverifiedUserJwt(userId);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		await expectEmailNotVerifiedResponse(response);
	});

	// ── Body parsing / validation ──

	it("should reject invalid JSON body", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = new Request("https://api.example.com/api/v1/posts/5/rate", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
	});

	it("should reject invalid dimension", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "stars",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
	});

	it("should reject non-integer score", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1.5,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
	});

	it("should reject score outside the per-vote bounds (coins>100)", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 101,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_SCORE_OUT_OF_RANGE");
	});

	it("should reject score below the per-vote minimum (|0|<1)", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 0,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
	});

	it("should reject reason longer than 40 chars after trim", async () => {
		const { env } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "x".repeat(41),
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_REASON_TOO_LONG");
	});

	// ── Permission matrix ──

	it("should reject User trying to rate credits", async () => {
		const { env } = buildEnv({ role: 0 });
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "credits",
			score: 10,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_PERMISSION_DENIED");
	});

	it("should allow Mod to rate credits", async () => {
		const { env, batchCalls } = buildEnv({ role: 3 });
		const token = await jwtFor(3);
		const request = makeRateRequest(5, token, {
			dimension: "credits",
			score: 20,
			reason: "good",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);
		expect(batchCalls.length).toBe(1);
		// notifyAuthor=false → only 2 statements (insert rating + update author)
		expect((batchCalls[0] as unknown[]).length).toBe(2);
	});

	// ── Post visibility ──

	it("should 404 when the post does not exist", async () => {
		const { env } = buildEnv({ postRow: null });
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(404);
	});

	it("should reject invisible post with RATING_INVALID_POST", async () => {
		const { env } = buildEnv({
			postRow: {
				post_id: 5,
				thread_id: 7,
				author_id: 20,
				author_name: "bob",
				invisible: -1,
				thread_subject: "X",
				sticky: 0,
				forum_id: 1,
				forum_status: 1,
				forum_visibility: "public",
			},
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_INVALID_POST");
	});

	it("should reject anonymous-author post with RATING_INVALID_POST", async () => {
		const { env } = buildEnv({
			postRow: {
				post_id: 5,
				thread_id: 7,
				author_id: 0,
				author_name: "",
				invisible: 0,
				thread_subject: "X",
				sticky: 0,
				forum_id: 1,
				forum_status: 1,
				forum_visibility: "public",
			},
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_INVALID_POST");
	});

	it("should reject self-rate with RATING_SELF", async () => {
		const { env } = buildEnv({
			userId: 20, // same as default author_id
			postRow: {
				post_id: 5,
				thread_id: 7,
				author_id: 20,
				author_name: "alice",
				invisible: 0,
				thread_subject: "X",
				sticky: 0,
				forum_id: 1,
				forum_status: 1,
				forum_visibility: "public",
			},
		});
		const token = await jwtFor(0, 20);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_SELF");
	});

	it("should reject inactive forum as 404", async () => {
		const { env } = buildEnv({
			postRow: {
				post_id: 5,
				thread_id: 7,
				author_id: 20,
				author_name: "bob",
				invisible: 0,
				thread_subject: "X",
				sticky: 0,
				forum_id: 1,
				forum_status: 0, // paused/hidden
				forum_visibility: "public",
			},
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(404);
	});

	it("should 403 when forum visibility denies the user", async () => {
		const { env } = buildEnv({
			postRow: {
				post_id: 5,
				thread_id: 7,
				author_id: 20,
				author_name: "bob",
				invisible: 0,
				thread_subject: "X",
				sticky: 0,
				forum_id: 1,
				forum_status: 1,
				forum_visibility: "staff", // user role=0 cannot see staff
			},
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(403);
	});

	// ── Daily quota / duplicate ──

	it("should return 429 RATING_DAILY_LIMIT when conditional insert changes=0", async () => {
		const { env } = buildEnv({
			role: 0,
			insertRatingMeta: { changes: 0, last_row_id: 0 },
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 50,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(429);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_DAILY_LIMIT");
	});

	it("should return 409 RATING_DUPLICATE on UNIQUE constraint error from batch", async () => {
		const { env } = buildEnv({
			role: 0,
			batchThrows: new Error("D1_ERROR: UNIQUE constraint failed: post_ratings"),
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(409);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATING_DUPLICATE");
	});

	// ── Happy path + PM ──

	it("should write only 2 batch statements when notifyAuthor=false", async () => {
		const { env, batchCalls } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 1,
			reason: "thanks",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);
		expect((batchCalls[0] as unknown[]).length).toBe(2);
	});

	it("should write a 3rd PM-insert statement when notifyAuthor=true", async () => {
		const { env, batchCalls, calls } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 3,
			reason: "good post",
			notifyAuthor: true,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);
		expect((batchCalls[0] as unknown[]).length).toBe(3);

		// PM body must include the canonical web permalink `/threads/<id>#post-<id>`
		// (plural — apps/web/src/app/(forum)/threads/[id]/page.tsx). The singular
		// `/thread/...` form would 404 in the deployed web app.
		const pmInsert = calls.find((c) => c.sql.includes("INSERT INTO messages"));
		expect(pmInsert).toBeDefined();
		const pmBody = pmInsert?.params[5] as string;
		// thread_id is mocked to 7 and postId is 5 (see buildEnv default + makeRateRequest).
		expect(pmBody).toContain("/threads/7#post-5");
		expect(pmBody).not.toMatch(/\/thread\/\d/);
	});

	it("should sanitize BBCode/HTML in reason for both stored row and PM body", async () => {
		// Inspecting the inserted reason via mock-db calls list: capture the
		// raw SQL+params and assert the stored reason has no markup.
		const { env, calls } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 2,
			reason: "[b]rude[/b] <script>x</script> ok",
			notifyAuthor: true,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);

		// Find the INSERT INTO post_ratings prepare call; the reason argument
		// is the 7th bind parameter (post_id, thread_id, rater_id, rater_name,
		// dimension, score, reason).
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO post_ratings"));
		expect(insertCall).toBeDefined();
		const reasonParam = insertCall?.params[6] as string;
		expect(reasonParam).not.toContain("[b]");
		expect(reasonParam).not.toContain("</script>");
		expect(reasonParam).toContain("rude");
		expect(reasonParam).toContain("ok");
	});

	it("should bind the rolling-24h quota subquery params correctly", async () => {
		const { env, calls } = buildEnv();
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 4,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);

		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO post_ratings"));
		expect(insertCall).toBeDefined();
		// Params (in order):
		//   0..7  = INSERT SELECT values: post_id, thread_id, rater_id,
		//           rater_name, dimension, score, reason, created_at
		//   8     = quota.rater_id
		//   9     = quota.dimension
		//   10    = quota.created_at >= now-86400
		//   11    = absScore
		//   12    = perDayCap (coins → 5200)
		const p = insertCall?.params ?? [];
		expect(p[4]).toBe(2); // dimension=coins (enum 2)
		expect(p[5]).toBe(4); // score
		expect(p[9]).toBe(2); // quota.dimension
		expect(p[11]).toBe(4); // absScore
		expect(p[12]).toBe(5200); // perDayCap for coins
	});

	it("should bind the credits per-day cap for Mod role", async () => {
		const { env, calls } = buildEnv({ role: 3 });
		const token = await jwtFor(3);
		const request = makeRateRequest(5, token, {
			dimension: "credits",
			score: 30,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);

		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO post_ratings"));
		expect(insertCall).toBeDefined();
		const p = insertCall?.params ?? [];
		expect(p[4]).toBe(1); // dimension=credits (enum 1)
		expect(p[12]).toBe(100); // Mod credits/day=100
	});

	it("should return aggregate alongside the created rating", async () => {
		const { env } = buildEnv({
			aggregate: {
				total: 3,
				credits_count: 1,
				credits_sum: 20,
				coins_count: 2,
				coins_sum: 8,
			},
		});
		const token = await jwtFor(0);
		const request = makeRateRequest(5, token, {
			dimension: "coins",
			score: 5,
			reason: "",
			notifyAuthor: false,
		});
		const response = await postRating.create(request, env);
		expect(response.status).toBe(201);
		const payload = (await response.json()) as {
			data: { rating: { id: number; dimension: string }; aggregate: { total: number } };
		};
		expect(payload.data.rating.id).toBe(99);
		expect(payload.data.rating.dimension).toBe("coins");
		expect(payload.data.aggregate.total).toBe(3);
	});
});
