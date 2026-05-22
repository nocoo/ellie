// Internal analytics ingest endpoint (P5).
//
// POST /api/internal/analytics/ingest
//
// Receives one page-view sample from the Next.js web proxy and pipes it
// into the in-isolate collector. The web proxy is the ONLY trusted
// caller: it forwards
//   - `X-Ingest-Key` — shared secret matching `env.ANALYTICS_INGEST_KEY`
//   - `X-Real-IP`   — the trusted client IP (CF-Connecting-IP or, in
//                     dev, XFF first hop), resolved web-side by
//                     `apps/web/src/lib/client-ip.ts`
//   - `User-Agent`  — pass-through of the original request UA
//   - JSON body of shape `{ path_kind, target_id, user_id }`
//
// Trust posture (D0 v2 + 4 pin reviewer ack):
//   1. The router MUST dispatch this route BEFORE `validateApiKey()` and
//      BEFORE any tracking/maintenance/admin middleware. Failure paths
//      (401 / 503 / 400) MUST NOT trigger `tryTrackAuth` or any other
//      observable side-effect. The router test in tests/unit/router
//      pins this ordering.
//   2. Secret check is the FIRST thing this handler does. The handler
//      returns 401 without reading X-Real-IP, UA, or the body when the
//      secret is missing / wrong. `trustXRealIp` opt-in into
//      `extractTrustedClientIp` is ONLY applied after the secret has
//      been verified constant-time.
//   3. Body validation is a STRICT WHITELIST: unknown keys → 400
//      `INVALID_REQUEST`. Reviewer-pinned: `bot_class` / `label` / `ip`
//      / `ua` MUST be rejected, not silently dropped, so protocol drift
//      surfaces.
//   4. The server is authoritative for `bot_class` (UA-derived),
//      `date_local` (Asia/Shanghai), and the client IP — none of these
//      are read from the body.
//
// `recordPageView(sample)` is followed by `scheduleFlush(env, ctx)` so
// in-isolate buckets actually drain to D1 over time. The first call
// after isolate boot flushes immediately; subsequent calls are
// throttled by `collect.ts` at one per 30s.

import { parseBotClass, recordPageView, scheduleFlush } from "../../lib/analytics/collect";
import type { PathKind } from "../../lib/analytics/types";
import { extractTrustedClientIp } from "../../lib/clientIp";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

const LOCAL_TZ_OFFSET_SEC = 8 * 3600;
const SEC_PER_DAY = 86_400;

/** Allowed body keys — used as a strict whitelist gate. */
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(["path_kind", "target_id", "user_id"]);

/** PathKind enum values — duplicated as a Set for whitelist validation. */
const PATH_KIND_VALUES: ReadonlySet<PathKind> = new Set<PathKind>([
	"thread",
	"forum",
	"user",
	"home",
	"digest",
	"search",
	"checkin",
	"messages",
	"auth_page",
	"other",
]);

/**
 * Constant-time string equality. Both inputs are walked to `Math.max`
 * length so a length-mismatch does NOT short-circuit (which would leak
 * the length of the configured secret via timing). Returns false on
 * mismatch and on differing length, but always after the same number of
 * char comparisons.
 *
 * The hex-specific helper in `lib/email-verify.ts` requires both inputs
 * to be hex strings; the ingest key is an opaque server-set value, so
 * we use a generic UTF-16-code-unit comparison here.
 */
export function constantTimeEqualStr(a: string, b: string): boolean {
	const len = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i++) {
		diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return diff === 0;
}

/** `YYYY-MM-DD` in Asia/Shanghai for the day containing `nowSec`. */
export function shanghaiDateLocal(nowSec: number): string {
	const localDayStart =
		Math.floor((nowSec + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY) * SEC_PER_DAY - LOCAL_TZ_OFFSET_SEC;
	const d = new Date(localDayStart * 1000 + LOCAL_TZ_OFFSET_SEC * 1000);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

interface ParsedBody {
	pathKind: PathKind;
	targetId: number;
	userId: number;
}

/**
 * Strict body validator. Returns `{ ok: true, value }` on a valid
 * shape, or `{ ok: false, code, message }` with the exact failure mode.
 *
 * Strict-whitelist semantics:
 *   - Unknown keys → reject (NOT silently drop). This is what surfaces
 *     drift between web client and worker as a hard 400 instead of a
 *     stale field that nobody notices.
 *   - Missing required key → reject.
 *   - Wrong type / out-of-range value → reject.
 */
export function validateIngestBody(
	raw: unknown,
): { ok: true; value: ParsedBody } | { ok: false; message: string } {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, message: "Body must be a JSON object" };
	}
	const obj = raw as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (!ALLOWED_BODY_KEYS.has(key)) {
			return { ok: false, message: `Unknown body field: ${key}` };
		}
	}
	const { path_kind, target_id, user_id } = obj;
	if (typeof path_kind !== "string" || !PATH_KIND_VALUES.has(path_kind as PathKind)) {
		return { ok: false, message: "path_kind must be one of the PathKind enum" };
	}
	if (
		typeof target_id !== "number" ||
		!Number.isFinite(target_id) ||
		!Number.isInteger(target_id) ||
		target_id < 0
	) {
		return { ok: false, message: "target_id must be a non-negative integer" };
	}
	if (
		typeof user_id !== "number" ||
		!Number.isFinite(user_id) ||
		!Number.isInteger(user_id) ||
		user_id < 0
	) {
		return { ok: false, message: "user_id must be a non-negative integer" };
	}
	return {
		ok: true,
		value: {
			pathKind: path_kind as PathKind,
			targetId: target_id,
			userId: user_id,
		},
	};
}

/**
 * `POST /api/internal/analytics/ingest`.
 *
 * Ordered so trust-edge concerns precede any side-effect:
 *   1. 405 if not POST.
 *   2. 503 if `ANALYTICS_INGEST_KEY` is unset (deployment hardening —
 *      a misconfigured worker MUST NOT silently accept anonymous
 *      ingest).
 *   3. 401 if `X-Ingest-Key` missing or mismatched. NOTHING ELSE
 *      happens on this branch: no header reads, no UA classification,
 *      no collector dispatch.
 *   4. 400 on body shape / whitelist failure.
 *   5. Resolve trusted IP via `extractTrustedClientIp(..., {
 *      trustXRealIp: true })` — opt-in only legal AFTER step 3.
 *   6. `parseBotClass(ua)` is the source of truth for bot_class.
 *   7. `recordPageView(sample)` + `scheduleFlush(env, ctx)`.
 *   8. 204 No Content (the web caller doesn't need a body).
 */
export async function analyticsIngestHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	if (request.method !== "POST") {
		return errorResponse(
			"METHOD_NOT_ALLOWED",
			405,
			{ message: "POST required for ingest" },
			origin,
		);
	}

	const configured = env.ANALYTICS_INGEST_KEY;
	if (!configured) {
		// Deployment hardening: refuse to start ingesting samples if the
		// secret has not been set. UI / cron continue to read the
		// already-persisted aggregate; only the writer is gated.
		return errorResponse(
			"INGEST_NOT_CONFIGURED",
			503,
			{ message: "ANALYTICS_INGEST_KEY not configured" },
			origin,
		);
	}

	const presented = request.headers.get("X-Ingest-Key") ?? request.headers.get("x-ingest-key");
	if (!presented || !constantTimeEqualStr(presented, configured)) {
		// 401 path is the trust boundary — no header reads beyond the
		// secret comparison, no UA classification, no collector dispatch.
		return errorResponse("UNAUTHORIZED", 401, { message: "Invalid ingest key" }, origin);
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return errorResponse("INVALID_REQUEST", 400, { message: "Malformed JSON body" }, origin);
	}
	const parsed = validateIngestBody(raw);
	if (!parsed.ok) {
		return errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin);
	}

	// Resolve trust-edge client IP eagerly to pin the trust contract even
	// though ingest does not currently persist it. Prefixed with `_` so the
	// linter does not flag the unused binding.
	const _ip = extractTrustedClientIp(request, env, { trustXRealIp: true }) ?? "";
	const ua =
		request.headers.get("X-Real-User-Agent") ??
		request.headers.get("User-Agent") ??
		request.headers.get("user-agent") ??
		"";
	const botClass = parseBotClass(ua);
	const nowSec = Math.floor(Date.now() / 1000);

	recordPageView({
		dateLocal: shanghaiDateLocal(nowSec),
		pathKind: parsed.value.pathKind,
		targetId: parsed.value.targetId,
		userId: parsed.value.userId,
		botClass,
		ts: nowSec,
	});

	// `ctx` is optional only in unit-test stubs; production routes always
	// receive a non-null context from the Workers runtime.
	if (ctx) {
		scheduleFlush(env, ctx);
	}

	return jsonResponse({ ok: true }, origin);
}

// Internal handles for tests — production code MUST go through the
// exported handler / helpers above.
export const _internal = {
	ALLOWED_BODY_KEYS,
	PATH_KIND_VALUES,
	// Surfacing `ip` for tests is intentional: ingest does not currently
	// persist IP, but pinning the resolution path keeps the trust-edge
	// contract reviewable.
};
