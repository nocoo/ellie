/**
 * Legacy Discuz URL → canonical path-segment URL.
 *
 * Single-source-of-truth for the four legacy URL shapes we 301 to the
 * canonical forum / thread routes:
 *
 *   A. HTML forum list:   /forum-:fid-:page.html
 *   B. HTML thread:       /thread-:tid-:page-:extra.html
 *   C. PHP forum list:    /forum.php?mod=forumdisplay&fid=:fid[&page=:page]
 *   D. PHP thread:        /forum.php?mod=viewthread&tid=:tid[&page=:page][&fid=:fid]
 *
 * Plus a query-page canonicalize pass so the OLD internal canonical
 * (`/forums/:fid?page=N`, `/threads/:tid?page=N`) is single-hop 301'd
 * to the NEW path-segment canonical (`/forums/:fid/:page`,
 * `/threads/:tid/:page`).
 *
 * # Canonical contract (frozen — reviewer pin)
 *
 *   - page 1 / missing page         → bare path  (e.g. `/forums/306`)
 *   - page >= 2                     → path segment (e.g. `/forums/306/2`)
 *   - non-positive / non-integer page → bare path (we never 301 to a
 *     fake page; the page route will 404)
 *
 * # Trust-edge contract
 *
 *   - The destination string is constructed from a WHITELIST: `fid`,
 *     `tid`, `page`, `mod`, plus the explicit `fid` for `returnTo`,
 *     plus the per-target preserved allowlist (`typeId` for forum,
 *     `returnTo` for thread) on the query-page / page-one canonicalize
 *     paths.
 *   - `extra`, `mobile`, `from`, `fromuid`, `cursor`, `direction`,
 *     `last`, and ANY other field on the input URL are dropped.
 *   - Allowlisted values are themselves shape-validated (`typeId` is a
 *     positive integer; `returnTo` is a same-site canonical
 *     `/forums/{fid}[/{page>=2}]` path). Malformed values are dropped,
 *     so canonical destinations never carry junk.
 *   - The original `url.search` is NEVER passed through.
 *
 * # returnTo
 *
 *   Three rules cover every shape:
 *
 *   1. `forum.php?mod=viewthread&tid=...&fid=NNN` (independent `fid`
 *      query param matching `^[1-9]\d*$`) GENERATES a fresh
 *      `?returnTo=/forums/NNN`.
 *   2. Query-page canonicalize (`/threads/:tid?page=N&returnTo=...`)
 *      and the page-one canonicalize (`/threads/:tid/1?returnTo=...`)
 *      PRESERVE an existing `returnTo` ONLY when it matches the
 *      `validateReturnTo` canonical shape (`/forums/{fid}` or
 *      `/forums/{fid}/{page>=2}`). Off-site, leading-zero, page=1
 *      segment, embedded `?`/`#`, or extra path segments are dropped.
 *   3. The HTML thread form (`thread-:tid-:p-:e`) NEVER emits
 *      returnTo — the trailing `extra` segment is the Discuz internal
 *      hash, not a forum id, and there is no other independent fid
 *      to derive from.
 *
 *   `returnTo` is appended via `URLSearchParams.toString()` to
 *   guarantee percent-encoding of the `/forums/NNN` path.
 *
 * # Pure
 *
 *   No I/O, no env, no headers. Caller (proxy.ts) feeds the request
 *   URL; this helper decides whether to redirect.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LegacyRedirect {
	/** Destination path + query (no origin). Always starts with `/`. */
	destination: string;
}

// ---------------------------------------------------------------------------
// Path patterns
// ---------------------------------------------------------------------------

/** /forum-{fid}-{page}.html */
const FORUM_HTML_RE = /^\/forum-(\d+)-(\d+)\.html$/;
/** /thread-{tid}-{page}-{extra}.html */
const THREAD_HTML_RE = /^\/thread-(\d+)-(\d+)-(\d+)\.html$/;
/** /forums/{fid}  — query-page canonicalize source */
const FORUMS_BARE_RE = /^\/forums\/(\d+)\/?$/;
/** /threads/{tid} — query-page canonicalize source */
const THREADS_BARE_RE = /^\/threads\/(\d+)\/?$/;
/** /forums/{fid}/{page}  — path-segment page=1 canonicalize source */
const FORUMS_PAGE_RE = /^\/forums\/(\d+)\/(\d+)$/;
/** /threads/{tid}/{page} — path-segment page=1 canonicalize source */
const THREADS_PAGE_RE = /^\/threads\/(\d+)\/(\d+)$/;

const FORUM_PHP_PATH = "/forum.php";

// ---------------------------------------------------------------------------
// Param coercion
// ---------------------------------------------------------------------------

/** Positive integer string (no leading zero, no sign). */
const POSITIVE_INT_RE = /^[1-9]\d*$/;

function parsePositiveInt(raw: string | null | undefined): number | null {
	if (raw == null) return null;
	if (!POSITIVE_INT_RE.test(raw)) return null;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Coerce a raw `page` value to a >= 2 integer or null. Null means
 * "render the bare path with no page segment" (page 1 / invalid).
 */
function coercePageGte2(raw: string | null | undefined): number | null {
	const n = parsePositiveInt(raw);
	if (n == null) return null;
	if (n < 2) return null;
	return n;
}

// ---------------------------------------------------------------------------
// Destination builders
// ---------------------------------------------------------------------------

/**
 * Build the canonical forum list destination.
 *
 *   page null / 1 → `/forums/:fid`
 *   page >= 2     → `/forums/:fid/:page`
 */
function buildForumDest(fid: number, page: number | null): string {
	const base = `/forums/${fid}`;
	return page != null && page >= 2 ? `${base}/${page}` : base;
}

/**
 * Build the canonical thread destination, optionally with a
 * percent-encoded `returnTo` query.
 *
 *   page null / 1 → `/threads/:tid`
 *   page >= 2     → `/threads/:tid/:page`
 *   + ?returnTo=/forums/:returnFid   (only when returnFid != null)
 */
function buildThreadDest(tid: number, page: number | null, returnFid: number | null): string {
	const base = `/threads/${tid}`;
	const path = page != null && page >= 2 ? `${base}/${page}` : base;
	if (returnFid == null) return path;
	const params = new URLSearchParams();
	params.set("returnTo", `/forums/${returnFid}`);
	return `${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Per-shape resolvers
// ---------------------------------------------------------------------------

/** A. /forum-{fid}-{page}.html */
function resolveForumHtml(pathname: string): LegacyRedirect | null {
	const m = FORUM_HTML_RE.exec(pathname);
	if (!m) return null;
	const fid = parsePositiveInt(m[1]);
	if (fid == null) return null;
	const page = coercePageGte2(m[2]);
	return { destination: buildForumDest(fid, page) };
}

/** B. /thread-{tid}-{page}-{extra}.html */
function resolveThreadHtml(pathname: string): LegacyRedirect | null {
	const m = THREAD_HTML_RE.exec(pathname);
	if (!m) return null;
	const tid = parsePositiveInt(m[1]);
	if (tid == null) return null;
	const page = coercePageGte2(m[2]);
	// `extra` (m[3]) is intentionally dropped — it's the Discuz internal
	// hash, not a forum id, so we never use it for returnTo.
	return { destination: buildThreadDest(tid, page, null) };
}

/** C/D. /forum.php?mod=... */
function resolveForumPhp(url: URL): LegacyRedirect | null {
	if (url.pathname !== FORUM_PHP_PATH) return null;
	const mod = url.searchParams.get("mod");
	if (mod === "forumdisplay") {
		const fid = parsePositiveInt(url.searchParams.get("fid"));
		if (fid == null) return null;
		const page = coercePageGte2(url.searchParams.get("page"));
		return { destination: buildForumDest(fid, page) };
	}
	if (mod === "viewthread") {
		const tid = parsePositiveInt(url.searchParams.get("tid"));
		if (tid == null) return null;
		const page = coercePageGte2(url.searchParams.get("page"));
		const returnFid = parsePositiveInt(url.searchParams.get("fid"));
		return { destination: buildThreadDest(tid, page, returnFid) };
	}
	return null;
}

/**
 * Pick a single non-empty string query value. `URLSearchParams.get`
 * returns the first value for repeated keys; we treat repeats as
 * single-string and `?key=` (empty) as absent.
 */
function pickStringQuery(url: URL, key: string): string | null {
	const v = url.searchParams.get(key);
	if (v == null || v === "") return null;
	return v;
}

/**
 * Forum-list query allowlist. Internal canonical surface for
 * `/forums/:fid[/:page]` is `?typeId=N` only — every other key on the
 * input URL is dropped (drop list: `page` is consumed into the path,
 * `mobile` / `from` / `fromuid` / `cursor` / `direction` / `last` /
 * arbitrary user-supplied keys never reach canonical).
 *
 * `typeId` is itself shape-checked (positive integer, no leading zero);
 * malformed values are dropped so canonical URLs never carry junk.
 */
function buildForumPreservedQuery(url: URL): string {
	const typeId = pickStringQuery(url, "typeId");
	if (typeId == null) return "";
	if (parsePositiveInt(typeId) == null) return "";
	const params = new URLSearchParams();
	params.set("typeId", typeId);
	return `?${params.toString()}`;
}

/**
 * Validate a `returnTo` query value as a same-forum canonical path,
 * matching the in-app `validateReturnTo` contract (thread-list.ts):
 *
 *   • `/forums/{fid}`
 *   • `/forums/{fid}/{page}` where page is a positive int >= 2
 *
 * Anything else (off-site URLs, `/admin/...`, page=1 segment, leading
 * zero, fragments, query strings) is rejected. We do NOT scope to a
 * specific thread's forum here (the helper has no thread context), but
 * the page render still re-validates via `validateReturnTo(_, forumId)`.
 */
function isCanonicalReturnTo(raw: string): boolean {
	if (raw === "" || !raw.startsWith("/forums/")) return false;
	if (raw.includes("?") || raw.includes("#")) return false;
	const tail = raw.slice("/forums/".length);
	const seg = tail.split("/");
	if (seg.length === 1) return POSITIVE_INT_RE.test(seg[0]);
	if (seg.length === 2) return POSITIVE_INT_RE.test(seg[0]) && coercePageGte2(seg[1]) != null;
	return false;
}

/**
 * Thread-detail query allowlist. Internal canonical surface for
 * `/threads/:tid[/:page]` is `?returnTo=...` only. `cursor` /
 * `direction` / `last` are pagination cursors that MUST NOT survive a
 * path-canonical redirect — the `:page` segment is authoritative once
 * we are on canonical.
 *
 * `returnTo` is shape-validated to a same-site `/forums/{fid}[/{page}]`
 * canonical path (mirrors `validateReturnTo`); anything else is dropped
 * so an attacker can't long-canonicalize an off-site / privileged URL.
 */
function buildThreadPreservedQuery(url: URL): string {
	const returnTo = pickStringQuery(url, "returnTo");
	if (returnTo == null) return "";
	if (!isCanonicalReturnTo(returnTo)) return "";
	const params = new URLSearchParams();
	params.set("returnTo", returnTo);
	return `?${params.toString()}`;
}

/**
 * E. /forums/:fid?page=N → path-segment canonical.
 *
 * Only fires when `?page=` is present (otherwise the URL is already
 * canonical and we let it through). page=1 is canonicalized to the
 * bare path; >= 2 to `/forums/:fid/:page`.
 *
 * The pathname must end with /forums/:fid (no trailing /:page already)
 * to avoid redirect loops on `/forums/:fid/:page?page=N` shapes.
 *
 * `typeId` is preserved on the destination (allowlist); all other
 * query keys are dropped.
 */
function resolveForumsQueryPage(url: URL): LegacyRedirect | null {
	const m = FORUMS_BARE_RE.exec(url.pathname);
	if (!m) return null;
	const fid = parsePositiveInt(m[1]);
	if (fid == null) return null;
	if (!url.searchParams.has("page")) return null;
	const page = coercePageGte2(url.searchParams.get("page"));
	return { destination: buildForumDest(fid, page) + buildForumPreservedQuery(url) };
}

/**
 * F. /threads/:tid?page=N → path-segment canonical.
 *
 * `returnTo` is preserved on the destination (allowlist); cursor /
 * direction / last and any unknown keys are dropped.
 */
function resolveThreadsQueryPage(url: URL): LegacyRedirect | null {
	const m = THREADS_BARE_RE.exec(url.pathname);
	if (!m) return null;
	const tid = parsePositiveInt(m[1]);
	if (tid == null) return null;
	if (!url.searchParams.has("page")) return null;
	const page = coercePageGte2(url.searchParams.get("page"));
	return { destination: buildThreadDest(tid, page, null) + buildThreadPreservedQuery(url) };
}

/**
 * G. /forums/:fid/1 → /forums/:fid  (path-segment page=1 canonicalize).
 *
 * Page=1 is NEVER canonical with a segment. We catch it at the proxy
 * so external links to `/forums/306/1` get a clean single-hop 301
 * (matching the legacy `.html` / `.php?page=1` redirects), instead of
 * relying on the `[page]/page.tsx` alias route's 308.
 *
 * Pages >= 2 fall through (they're canonical and the alias route
 * renders them in place).
 */
function resolveForumsPageOne(url: URL): LegacyRedirect | null {
	const m = FORUMS_PAGE_RE.exec(url.pathname);
	if (!m) return null;
	const fid = parsePositiveInt(m[1]);
	if (fid == null) return null;
	const pageRaw = m[2];
	if (!POSITIVE_INT_RE.test(pageRaw)) return null;
	if (pageRaw !== "1") return null;
	return { destination: buildForumDest(fid, null) + buildForumPreservedQuery(url) };
}

/** H. /threads/:tid/1 → /threads/:tid. Same rationale as G. */
function resolveThreadsPageOne(url: URL): LegacyRedirect | null {
	const m = THREADS_PAGE_RE.exec(url.pathname);
	if (!m) return null;
	const tid = parsePositiveInt(m[1]);
	if (tid == null) return null;
	const pageRaw = m[2];
	if (!POSITIVE_INT_RE.test(pageRaw)) return null;
	if (pageRaw !== "1") return null;
	return { destination: buildThreadDest(tid, null, null) + buildThreadPreservedQuery(url) };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Resolve a legacy or non-canonical URL to its canonical 301 target.
 *
 * Returns `null` when the URL is not one we handle — caller MUST then
 * fall through to normal routing. Never throws.
 *
 * The returned `destination` is a path + optional query, never an
 * absolute URL; the caller is responsible for resolving it against the
 * request origin (e.g. `new URL(dest, request.nextUrl.origin)`).
 */
export function resolveLegacyDiscuzRedirect(url: URL): LegacyRedirect | null {
	return (
		resolveForumHtml(url.pathname) ??
		resolveThreadHtml(url.pathname) ??
		resolveForumPhp(url) ??
		resolveForumsQueryPage(url) ??
		resolveThreadsQueryPage(url) ??
		resolveForumsPageOne(url) ??
		resolveThreadsPageOne(url)
	);
}
