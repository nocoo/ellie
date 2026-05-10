// Architecture guard — Phase B cache-layer abstraction.
//
// Two cache boundaries are enforced:
//
//  1. RSC render-pass dedupe (React `cache()`):
//     - `import { cache } from "react"` is allowed ONLY in
//       `apps/web/src/lib/forum-cache.ts`.
//     - The bare call `cache(` (when used as a React-cache wrapper)
//       is also restricted to that file. We detect this conservatively
//       by flagging any token `cache(` outside the allowed file. The
//       TTL utility uses the identifier `createTtlCache` and the cache
//       instance method names like `cache.get(`, `cache.clear(`, which
//       are intentionally NOT matched (regex requires a leading
//       non-identifier char before `cache`, so `createTtlCache(` and
//       `.cache(` never match).
//
//  2. In-memory TTL state with concurrency dedupe:
//     - The TTL primitive lives ONLY in `apps/web/src/lib/ttl-cache.ts`.
//     - Module-level identifiers historically used to roll ad-hoc TTL
//       caches (`cacheExpiry`, `CACHE_TTL`, `cachedData`, `cachedAt`,
//       `expiresAt`, `ttlMs`, `ttl`, `inFlight`, `inflight`,
//       `requireLoginCache`) are forbidden in `apps/web/src/` outside
//       `lib/ttl-cache.ts` itself.
//
// Scanner approach: reuse the line-preserving comment + string stripper
// from `no-raw-fetch.test.ts` so file:line numbers in failures point at
// real code. Template literals are intentionally NOT stripped (same
// trade-off as the Phase A guard).

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = new URL("../../../src", import.meta.url).pathname;

const REACT_CACHE_FILE = "lib/forum-cache.ts";
const TTL_CACHE_FILE = "lib/ttl-cache.ts";

const TEST_FILE_RE = /(^|\/)(tests|__tests__)\//;
const TEST_BASENAME_RE = /\.(test|spec)\.tsx?$/;

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

function isCandidateFile(relPosix: string): boolean {
	if (!relPosix.endsWith(".ts") && !relPosix.endsWith(".tsx")) return false;
	if (relPosix.endsWith(".d.ts")) return false;
	if (TEST_FILE_RE.test(relPosix)) return false;
	if (TEST_BASENAME_RE.test(relPosix)) return false;
	return true;
}

// ---------------------------------------------------------------------------
// stripCommentsAndStrings — copied from no-raw-fetch.test.ts. Two guards
// share the same conservative parser; keeping a local copy avoids a
// cross-test import dependency.
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
// Pattern matchers
// ---------------------------------------------------------------------------

// `import { ..., cache, ... } from "react"` (or single import)
const REACT_CACHE_IMPORT_RE = /import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/;

// Bare `cache(` token. We require the char before `cache` to NOT be an
// identifier char so that `createTtlCache(`, `.cache(`, `myCache(` etc.
// do not match. Using a lookbehind would be cleaner but we go with a
// scanner-friendly inverse class for portability.
const BARE_CACHE_CALL_RE = /(^|[^A-Za-z0-9_$.])cache\s*\(/;

// Forbidden module-level TTL identifiers. Word-boundaried.
const TTL_IDENTIFIERS = [
	"cacheExpiry",
	"CACHE_TTL",
	"cachedData",
	"cachedAt",
	"expiresAt",
	"ttlMs",
	"inFlight",
	"inflight",
	"requireLoginCache",
] as const;

// `ttl` is a very common substring; keep it scoped to a standalone
// identifier (not part of a longer name like `httpTtl` or `ttlSeconds`)
// by requiring word boundaries on both sides.
const TTL_BARE_RE = /\bttl\b/;

function findLines(stripped: string, predicate: (line: string) => boolean): number[] {
	const lines: number[] = [];
	const all = stripped.split("\n");
	for (let i = 0; i < all.length; i += 1) {
		if (predicate(all[i])) lines.push(i + 1);
	}
	return lines;
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

function checkReactCacheBoundary(rel: string, stripped: string): Violation[] {
	if (rel === REACT_CACHE_FILE) return [];
	const out: Violation[] = [];
	const importLines = findLines(stripped, (l) => REACT_CACHE_IMPORT_RE.test(l));
	if (importLines.length > 0) {
		out.push({
			file: rel,
			rule: "React `import { cache } from 'react'` is only allowed in lib/forum-cache.ts",
			lines: importLines,
		});
	}
	const callLines = findLines(stripped, (l) => BARE_CACHE_CALL_RE.test(l));
	if (callLines.length > 0) {
		out.push({
			file: rel,
			rule: "Bare `cache(` call is only allowed in lib/forum-cache.ts (use createTtlCache for TTL caches)",
			lines: callLines,
		});
	}
	return out;
}

function checkTtlBoundary(rel: string, stripped: string): Violation[] {
	if (rel === TTL_CACHE_FILE) return [];
	const out: Violation[] = [];
	for (const ident of TTL_IDENTIFIERS) {
		const lines = findIdentifierLines(stripped, ident);
		if (lines.length > 0) {
			out.push({
				file: rel,
				rule: `Ad-hoc TTL identifier \`${ident}\` is only allowed in lib/ttl-cache.ts`,
				lines,
			});
		}
	}
	const ttlLines = findLines(stripped, (l) => TTL_BARE_RE.test(l));
	if (ttlLines.length > 0) {
		out.push({
			file: rel,
			rule: "Bare `ttl` identifier is only allowed in lib/ttl-cache.ts",
			lines: ttlLines,
		});
	}
	return out;
}

describe("architecture: Phase B — cache-layer boundaries in apps/web/src", () => {
	it("React `cache()` and ad-hoc TTL state are confined to their boundary files", async () => {
		const violations: Violation[] = [];

		for await (const abs of walk(SRC_ROOT)) {
			const rel = toPosix(relative(SRC_ROOT, abs));
			if (!isCandidateFile(rel)) continue;

			const src = await readFile(abs, "utf8");
			const stripped = stripCommentsAndStrings(src);

			violations.push(...checkReactCacheBoundary(rel, stripped));
			violations.push(...checkTtlBoundary(rel, stripped));
		}

		if (violations.length > 0) {
			const message = [
				"Phase B cache-layer guard: ad-hoc cache state is forbidden.",
				"  - React render-pass dedupe must go through `lib/forum-cache.ts`.",
				"  - In-memory TTL caches must be built with `createTtlCache` from",
				"    `lib/ttl-cache.ts` (single home for cacheExpiry / CACHE_TTL /",
				"    cachedData / cachedAt / expiresAt / ttlMs / ttl / inFlight /",
				"    inflight / requireLoginCache).",
				"",
				"Violations:",
				...violations.map((v) => `  - apps/web/src/${v.file}:${v.lines.join(",")}  [${v.rule}]`),
			].join("\n");
			expect.fail(message);
		}
	});
});
