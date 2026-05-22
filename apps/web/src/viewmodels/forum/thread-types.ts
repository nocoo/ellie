/**
 * Web public viewmodel for 主题分类 — Phase 4 / #9.
 *
 * Consumes the PUBLIC payload from
 * `GET /api/v1/forums/:forumId/thread-types`, which is a flat shape:
 *
 *     { enabled, required, listable, prefix, types: ForumThreadType[] }
 *
 * NOTE: the admin surface returns `{ forumId, config, types }` — that DTO
 * is intentionally NOT reused here. Web consumers MUST go through the
 * public endpoint and the helpers in this file so we don't accidentally
 * leak admin-only fields (sourceTypeid) or drift from the canonical Worker
 * shape (reviewer pin msg 6717fc27 #1).
 *
 * Pure helpers only — no `forumApi`, no React, no `server-only`. Data
 * fetch lives in `lib/forum-data.ts` (loader) and `lib/forum-cache.ts`
 * (RSC dedupe). Keeping the helpers pure lets us unit-test typeId
 * coercion / URL building / visibility predicates without touching the
 * Worker.
 */

import type { ForumThreadType } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Public payload from `GET /api/v1/forums/:forumId/thread-types`.
 *
 * Top-level config flags mirror `Forum.threadTypes` for callers that
 * already hold the Forum DTO; `types` contains ONLY enabled rows
 * (tombstones are not surfaced — historical badges flow through
 * `thread.typeName` denorm).
 */
export interface ForumThreadTypesPublic {
	enabled: boolean;
	required: boolean;
	listable: boolean;
	prefix: boolean;
	types: ForumThreadType[];
}

// ---------------------------------------------------------------------------
// typeId param coercion + whitelist normalization
// ---------------------------------------------------------------------------

/**
 * Coerce a raw `?typeId=` query value into a non-negative integer.
 *
 * Accepts: positive integer strings only (no leading zeros, no decimals,
 * no signs, no `1abc` tail). Anything else — including `null`, `undefined`,
 * empty string, `"0"`, arrays — returns `null` meaning "no filter".
 *
 * `0` is intentionally rejected because callers treat it as "no filter"
 * and we don't want to round-trip `typeId=0` in URLs (reviewer pin
 * msg 6717fc27 #2).
 */
export function coerceTypeIdParam(raw: string | string[] | undefined | null): number | null {
	if (raw == null) return null;
	if (Array.isArray(raw)) return null;
	if (raw === "") return null;
	if (!/^[1-9]\d*$/.test(raw)) return null;
	const n = Number.parseInt(raw, 10);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

/**
 * Whitelist-normalize a typeId against the forum's public payload.
 *
 * Returns the typeId only if:
 *   • payload is non-null
 *   • `enabled && listable` is true (filter UI is supposed to be live)
 *   • `typeId` matches an `id` in `types[]`
 *
 * Otherwise returns `null` — caller treats this as "show all threads,
 * don't select any pill". This is the key invariant from reviewer pin
 * msg 6717fc27 #2: non-existent / disabled / mismatched typeIds must
 * NOT be forwarded to the Worker (no 400 round-trips).
 */
export function normalizeTypeId(
	typeId: number | null,
	payload: ForumThreadTypesPublic | null,
): number | null {
	if (typeId == null) return null;
	if (!payload) return null;
	if (!payload.enabled || !payload.listable) return null;
	const found = payload.types.find((t) => t.id === typeId);
	return found ? typeId : null;
}

// ---------------------------------------------------------------------------
// Visibility predicates — keep noise out of forums with no categories
// ---------------------------------------------------------------------------

/**
 * Show the inline filter pill row when the forum has the master switch
 * on, listing turned on, and at least one enabled row to filter by.
 *
 * Mirrors the Worker pin: most forums have no categories, so the UI must
 * be silent when any precondition fails (reviewer msg ffc82124 / 6717fc27).
 */
export function shouldShowFilter(payload: ForumThreadTypesPublic | null): boolean {
	if (!payload) return false;
	if (!payload.enabled) return false;
	if (!payload.listable) return false;
	return payload.types.length > 0;
}

/**
 * Show the type picker in the new-thread compose UI when the forum's
 * master switch is on AND at least one enabled type exists. `required`
 * controls whether the picker can be skipped, not whether it renders.
 */
export function shouldShowPicker(payload: ForumThreadTypesPublic | null): boolean {
	if (!payload) return false;
	if (!payload.enabled) return false;
	return payload.types.length > 0;
}

/**
 * Decide whether the typeName badge / prefix should be rendered on a
 * thread row. The forum's `prefix` switch is the master toggle — when
 * off, the typeName badge is suppressed regardless of denorm content.
 *
 * Historical disabled categories still surface as long as `thread.typeName`
 * is populated and `prefix=true` on the forum (reviewer msg ffc82124).
 *
 * `null` payload (no per-forum config available, e.g. forum tree
 * fallback) means "don't hide". This keeps the badge visible on caller
 * paths that haven't wired thread-types config yet.
 */
export function shouldShowTypeNameBadge(payload: ForumThreadTypesPublic | null): boolean {
	if (!payload) return true;
	return payload.prefix === true;
}

// ---------------------------------------------------------------------------
// URL builders — preserve typeId across page/returnTo
// ---------------------------------------------------------------------------

/**
 * Build the canonical forum list URL for a given forumId / page / typeId.
 *
 * Conventions (path-segment canonical — reviewer pin):
 *   • Page 1 (or undefined): bare path `/forums/:fid`
 *   • Page >= 2:            `/forums/:fid/:page`
 *   • `typeId=null` or `typeId=0` omits the `typeId` query
 *   • Switching `typeId` should reset to page 1 (callers do that BEFORE
 *     calling this builder; the builder is path-agnostic)
 *
 * Extra query params (currently only `typeId`) are appended after the
 * page segment. URLs are deduplicatable by string equality.
 */
export function buildForumListUrl(opts: {
	forumId: number;
	page?: number;
	typeId?: number | null;
}): string {
	const base = `/forums/${opts.forumId}`;
	const path = opts.page != null && opts.page > 1 ? `${base}/${opts.page}` : base;
	const params = new URLSearchParams();
	if (opts.typeId != null && opts.typeId > 0) params.set("typeId", String(opts.typeId));
	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}

/**
 * Build a `returnTo` value the thread detail page can round-trip back
 * to the list (with current typeId preserved). Calls
 * `buildForumListUrl` internally so URL conventions match exactly.
 */
export function buildForumListReturnTo(opts: {
	forumId: number;
	page?: number;
	typeId?: number | null;
}): string {
	return buildForumListUrl(opts);
}

// ---------------------------------------------------------------------------
// Server error mapping — friendly Chinese strings for create failures
// ---------------------------------------------------------------------------

/**
 * Map a Worker create-thread error envelope to a user-facing string.
 *
 * Reviewer pin msg 6717fc27 #5: the Worker's create-thread surface uses
 * `INVALID_BODY` + a free-text `details.message` for typeId problems —
 * it does NOT emit dedicated codes like `THREAD_TYPE_REQUIRED`. We
 * pattern-match on the message text to surface a friendlier label, and
 * fall back to the raw server message (or a generic string) otherwise.
 *
 * Inputs are intentionally loose (`unknown`) so callers can pass
 * whatever shape they get back from `apiClient` without casts.
 */
export function mapCreateThreadTypeError(err: unknown): string | null {
	const message = readErrorMessage(err);
	if (!message) return null;
	if (/required|必选|必须/i.test(message) && /分类|type/i.test(message)) {
		return "请选择主题分类";
	}
	if (/forum.*mismatch|不属于|不匹配/i.test(message)) {
		return "主题分类与当前版面不匹配，请重新选择";
	}
	if (/(invalid|未知|不存在|disabled).*type|type.*(invalid|not found|disabled)/i.test(message)) {
		return "主题分类不存在或已停用，请重新选择";
	}
	return null;
}

function readErrorMessage(err: unknown): string | null {
	if (err == null) return null;
	if (typeof err === "string") return err;
	if (typeof err !== "object") return null;
	const obj = err as Record<string, unknown>;
	const direct = typeof obj.message === "string" ? obj.message : null;
	const details =
		obj.details && typeof obj.details === "object"
			? (() => {
					const d = obj.details as Record<string, unknown>;
					return typeof d.message === "string" ? d.message : null;
				})()
			: null;
	return details ?? direct;
}
