// Architecture guard — Phase C route-proxy abstraction.
//
// Forbids hand-rolled forum proxy boilerplate in Next route handlers under
// `apps/web/src/app/api/v1/**/route.ts`. Any new v1 route handler must
// declare itself via `proxyRoute()` from `@/lib/forum-route-proxy` and
// must not directly reach into the underlying network/auth/csrf/error
// helpers.
//
// Two scans run on every candidate route file (.ts under
// `app/api/v1/.../route.ts`) that is NOT in the explicit allowlist:
//
//  1. Forbidden module imports — `from "@/lib/forum-api" |
//     "@/lib/forum-auth" | "@/lib/csrf" | "@/lib/proxy-error"`.
//
//  2. Forbidden symbol tokens — `forumApi`, `ForumApiError`,
//     `getWorkerJwt`, `validateOrigin`, `isMutatingMethod`,
//     `forumApiErrorToProxyResponse`, `isEmailNotVerifiedPayload`.
//     This catches namespace re-exports / aliasing that bypass the
//     module-level import scan.
//
//  3. Positive rule — every non-allowlist route MUST `import` from
//     `@/lib/forum-route-proxy` and reference the `proxyRoute` symbol.
//     This prevents bypass via hand-rolled `NextResponse.json(...)` or
//     re-routing through some other helper that still sidesteps the
//     standard declarative shape.
//
// Allowlist captures route files that legitimately diverge from the
// `proxyRoute` shape (optional auth, custom error/transform, raw multipart,
// etc.). Each entry has a written reason and must be sign-off'd by the
// reviewer; a stale allowlist entry (file no longer exists) fails the
// guard so the list cannot rot. Inline bypass (suppression comments) is
// not supported — every exception goes through the allowlist.
//
// Scanner reuses the conservative comment+string stripper from
// `no-raw-fetch.test.ts` / `no-adhoc-cache.test.ts` so failures point at
// real source lines.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = new URL("../../../src", import.meta.url).pathname;
const V1_ROUTES_DIR = join(SRC_ROOT, "app", "api", "v1");

// ---------------------------------------------------------------------------
// Allowlist — route files exempt from the route-proxy abstraction.
//
// Paths are POSIX-style, relative to `apps/web/src/`. Each value is the
// disqualifier reason (why the file cannot adopt `proxyRoute()` today).
// Adding to this map requires reviewer sign-off. New "standard" v1 routes
// must use `lib/forum-route-proxy.ts`; do not add files here as a workaround.
// ---------------------------------------------------------------------------
const ALLOWLIST: Record<string, string> = {
	// Group A — JWT acquisition emits a distinct `"Failed to get session"`
	// 500 message that current callers depend on. proxyRoute collapses to
	// a generic `"Internal server error"`. Will migrate after error-message
	// unification.
	"app/api/v1/checkin/route.ts": "JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/messages/route.ts": "JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/messages/mark-all-read/route.ts":
		"JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/posting-permission/route.ts":
		"JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/posts/route.ts": "JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/reports/route.ts": "JWT try/catch with 'Failed to get session' 500 message",
	"app/api/v1/threads/route.ts": "JWT try/catch with 'Failed to get session' 500 message",

	// Group B — DELETE wire body diverges from `body:"empty"`. Worker call
	// passes `undefined` body (no Content-Type), proxyRoute's "empty"
	// strategy would send `{}` + `application/json`. Defer until helper
	// gains `body:"none"` or Worker confirms equivalence.
	"app/api/v1/messages/[id]/route.ts": "DELETE sends undefined wire body (no Content-Type)",

	// Group C — optional-auth (forwards JWT only when session exists; falls
	// back to anonymous Worker call). proxyRoute today is auth=required or
	// nothing; needs `auth:"optional"` support.
	"app/api/v1/forums/route.ts": "optional auth (anonymous fallback)",
	"app/api/v1/users/[id]/route.ts": "optional auth (anonymous fallback)",
	"app/api/v1/users/search/route.ts":
		"no-auth GET with query passthrough (Worker call without JWT)",

	// Group D — custom error mapping or response transform that does not
	// fit `onForumApiError` / `transform` defaults yet.
	"app/api/v1/posts/[id]/attachments/route.ts": "custom error/transform shape",
	"app/api/v1/settings/route.ts": "custom error/transform shape",

	// Group E — body sanitization or special PATCH-auth wiring that needs
	// pre-dispatch input mutation not yet exposed by proxyRoute.
	"app/api/v1/users/me/route.ts": "body sanitization before dispatch",
	"app/api/v1/users/me/password/route.ts": "body sanitization before dispatch",
	"app/api/v1/users/me/email/request-code/route.ts": "body sanitization before dispatch",
	"app/api/v1/users/me/email/verify/route.ts": "body sanitization before dispatch",
	"app/api/v1/users/me/email/correct/route.ts": "body sanitization before dispatch",

	// Group F — mixed handler shape (multiple methods with divergent
	// auth/body strategies in one file).
	"app/api/v1/post-comments/route.ts": "mixed handler shape with divergent auth/body",

	// Group G — multipart upload, raw fetch passthrough; not a JSON proxy.
	"app/api/v1/upload/route.ts": "raw multipart upload passthrough",
};

// ---------------------------------------------------------------------------
// Scanner — comment+string stripper copied from sibling guards.
// ---------------------------------------------------------------------------
type Mode = "code" | "line-comment" | "block-comment" | "string-single" | "string-double";

interface Step {
	emit: string;
	advance: number;
	mode: Mode;
}

const CODE_TRANSITIONS: Record<string, { mode: Mode; emit: string; advance: number }> = {
	"//": { mode: "line-comment", emit: "  ", advance: 2 },
	"/*": { mode: "block-comment", emit: "  ", advance: 2 },
	"'": { mode: "string-single", emit: " ", advance: 1 },
	'"': { mode: "string-double", emit: " ", advance: 1 },
};

function stepCode(c: string, c2: string): Step {
	const two = CODE_TRANSITIONS[c + c2];
	if (two) return two;
	const one = CODE_TRANSITIONS[c];
	if (one) return one;
	return { emit: c, advance: 1, mode: "code" };
}

function stepLineComment(c: string): Step {
	if (c === "\n") return { emit: "\n", advance: 1, mode: "code" };
	return { emit: " ", advance: 1, mode: "line-comment" };
}

function stepBlockComment(c: string, c2: string): Step {
	if (c === "*" && c2 === "/") return { emit: "  ", advance: 2, mode: "code" };
	return { emit: c === "\n" ? "\n" : " ", advance: 1, mode: "block-comment" };
}

function stepQuoted(c: string, next: string, mode: Mode, terminator: string): Step {
	if (c === "\\" && next !== "") {
		return { emit: next === "\n" ? "  \n" : "  ", advance: 2, mode };
	}
	if (c === terminator) return { emit: " ", advance: 1, mode: "code" };
	return { emit: c === "\n" ? "\n" : " ", advance: 1, mode };
}

function nextStep(mode: Mode, c: string, c2: string, next: string): Step {
	if (mode === "code") return stepCode(c, c2);
	if (mode === "line-comment") return stepLineComment(c);
	if (mode === "block-comment") return stepBlockComment(c, c2);
	if (mode === "string-single") return stepQuoted(c, next, mode, "'");
	return stepQuoted(c, next, mode, '"');
}

function stripCommentsAndStrings(src: string): string {
	const out: string[] = [];
	let i = 0;
	const n = src.length;
	let mode: Mode = "code";
	while (i < n) {
		const c = src[i];
		const c2 = i + 1 < n ? src[i + 1] : "";
		const next = i + 1 < n ? src[i + 1] : "";
		const step = nextStep(mode, c, c2, next);
		out.push(step.emit);
		i += step.advance;
		mode = step.mode;
	}
	return out.join("");
}

// ---------------------------------------------------------------------------
// Walk + filter
// ---------------------------------------------------------------------------
async function* walk(dir: string): AsyncGenerator<string> {
	const entries = await readdir(dir);
	for (const entry of entries) {
		const full = join(dir, entry);
		const s = await stat(full);
		if (s.isDirectory()) {
			yield* walk(full);
		} else if (s.isFile()) {
			yield full;
		}
	}
}

function toPosix(p: string): string {
	return sep === "/" ? p : p.split(sep).join("/");
}

async function exists(abs: string): Promise<boolean> {
	try {
		const s = await stat(abs);
		return s.isFile();
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Forbidden patterns
// ---------------------------------------------------------------------------
const FORBIDDEN_MODULES: readonly string[] = [
	"@/lib/forum-api",
	"@/lib/forum-auth",
	"@/lib/csrf",
	"@/lib/proxy-error",
];

const FORBIDDEN_SYMBOLS: readonly string[] = [
	"forumApi",
	"ForumApiError",
	"getWorkerJwt",
	"validateOrigin",
	"isMutatingMethod",
	"forumApiErrorToProxyResponse",
	"isEmailNotVerifiedPayload",
];

function findLines(stripped: string, predicate: (line: string) => boolean): number[] {
	const lines: number[] = [];
	const all = stripped.split("\n");
	for (let i = 0; i < all.length; i += 1) {
		if (predicate(all[i])) lines.push(i + 1);
	}
	return lines;
}

function importsFrom(line: string, mod: string): boolean {
	// Match `from "<mod>"` or `from '<mod>'`. We scan stripped source where
	// string literal contents are blanked, so we re-check the ORIGINAL line
	// at the call site instead. To keep this self-contained, the scanner
	// passes the original line array separately.
	return new RegExp(`from\\s*["']${mod.replace(/[/\-]/g, (c) => `\\${c}`)}["']`).test(line);
}

function findIdentifierLines(stripped: string, ident: string): number[] {
	const re = new RegExp(`\\b${ident}\\b`);
	return findLines(stripped, (l) => re.test(l));
}

interface Violation {
	file: string;
	rule: string;
	lines: number[];
}

function checkForbiddenImports(rel: string, originalLines: string[]): Violation[] {
	const out: Violation[] = [];
	for (const mod of FORBIDDEN_MODULES) {
		const lines: number[] = [];
		for (let i = 0; i < originalLines.length; i += 1) {
			if (importsFrom(originalLines[i], mod)) lines.push(i + 1);
		}
		if (lines.length > 0) {
			out.push({
				file: rel,
				rule: `forbidden import from \`${mod}\` — use \`proxyRoute()\` from \`@/lib/forum-route-proxy\``,
				lines,
			});
		}
	}
	return out;
}

function checkForbiddenSymbols(rel: string, stripped: string): Violation[] {
	const out: Violation[] = [];
	for (const sym of FORBIDDEN_SYMBOLS) {
		const lines = findIdentifierLines(stripped, sym);
		if (lines.length > 0) {
			out.push({
				file: rel,
				rule: `forbidden symbol \`${sym}\` — use \`proxyRoute()\` from \`@/lib/forum-route-proxy\``,
				lines,
			});
		}
	}
	return out;
}

describe("architecture: Phase C — v1 route handlers must use proxyRoute()", () => {
	it("non-allowlisted v1 routes do not import or reference forbidden helpers", async () => {
		const violations: Violation[] = [];

		for await (const abs of walk(V1_ROUTES_DIR)) {
			const rel = toPosix(relative(SRC_ROOT, abs));
			if (!rel.endsWith("/route.ts") && !rel.endsWith("/route.tsx")) continue;
			if (rel in ALLOWLIST) continue;

			const src = await readFile(abs, "utf8");
			const stripped = stripCommentsAndStrings(src);
			const originalLines = src.split("\n");

			violations.push(...checkForbiddenImports(rel, originalLines));
			violations.push(...checkForbiddenSymbols(rel, stripped));
		}

		if (violations.length > 0) {
			const message = [
				"Phase C route-proxy guard: v1 route handlers must declare via",
				"`proxyRoute()` from `@/lib/forum-route-proxy.ts`.",
				"",
				"Do NOT import `@/lib/forum-api`, `@/lib/forum-auth`, `@/lib/csrf`,",
				"or `@/lib/proxy-error` directly from a route handler, and do not",
				"reference the symbols `forumApi`, `ForumApiError`, `getWorkerJwt`,",
				"`validateOrigin`, `isMutatingMethod`, `forumApiErrorToProxyResponse`,",
				"`isEmailNotVerifiedPayload`.",
				"",
				"If a route legitimately cannot adopt `proxyRoute()` (custom error",
				"shape, optional auth, multipart, etc.), add it to the ALLOWLIST in",
				"`tests/unit/architecture/no-adhoc-route-proxy.test.ts` with a written",
				"reason and reviewer sign-off. Inline bypass is not supported.",
				"",
				"Violations:",
				...violations.map((v) => `  - apps/web/src/${v.file}:${v.lines.join(",")}  [${v.rule}]`),
			].join("\n");
			expect.fail(message);
		}
	});

	it("ALLOWLIST entries reference existing files (no stale allowlist)", async () => {
		const stale: string[] = [];
		for (const rel of Object.keys(ALLOWLIST)) {
			const abs = join(SRC_ROOT, rel);
			if (!(await exists(abs))) stale.push(rel);
		}
		if (stale.length > 0) {
			expect.fail(
				[
					"Phase C route-proxy guard: ALLOWLIST has stale entries.",
					"Each entry must point at an existing file under apps/web/src/.",
					"Remove entries for files that have been migrated or deleted.",
					"",
					"Stale entries:",
					...stale.map((r) => `  - ${r}`),
				].join("\n"),
			);
		}
	});

	it("non-allowlisted v1 routes import and use `proxyRoute` from `@/lib/forum-route-proxy`", async () => {
		const missing: { file: string; reason: string }[] = [];

		for await (const abs of walk(V1_ROUTES_DIR)) {
			const rel = toPosix(relative(SRC_ROOT, abs));
			if (!rel.endsWith("/route.ts") && !rel.endsWith("/route.tsx")) continue;
			if (rel in ALLOWLIST) continue;

			const src = await readFile(abs, "utf8");
			const stripped = stripCommentsAndStrings(src);
			const originalLines = src.split("\n");

			const hasImport = originalLines.some((line) => importsFrom(line, "@/lib/forum-route-proxy"));
			const hasUsage = /\bproxyRoute\b/.test(stripped);

			if (!hasImport) {
				missing.push({ file: rel, reason: 'missing `import ... from "@/lib/forum-route-proxy"`' });
			} else if (!hasUsage) {
				missing.push({
					file: rel,
					reason: "imports forum-route-proxy but never references `proxyRoute`",
				});
			}
		}

		if (missing.length > 0) {
			const message = [
				"Phase C route-proxy guard: v1 route handlers must declare via",
				"`proxyRoute()` from `@/lib/forum-route-proxy.ts`.",
				"",
				"Hand-rolled `NextResponse.json(...)` route handlers, or routes that",
				"delegate to other helpers, are not allowed for standard v1 proxy",
				"routes. If the route legitimately cannot adopt `proxyRoute()`,",
				"add it to the ALLOWLIST with a written reason and reviewer sign-off.",
				"Inline bypass is not supported.",
				"",
				"Violations:",
				...missing.map((m) => `  - apps/web/src/${m.file}  [${m.reason}]`),
			].join("\n");
			expect.fail(message);
		}
	});
});
