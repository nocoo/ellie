// Architecture guard — Phase A network-layer abstraction.
//
// Forbids raw `fetch(` in `apps/web/src/` outside an allowlist. Any new
// browser network call must route through `@/lib/api-client` (or the
// browser facade `@/lib/forum-browser-api` that sits on top of it).
//
// Allowlist captures the legitimate network boundaries that we don't want
// to abstract this phase:
//   - the api-client + server-only Worker client themselves
//   - the NextAuth login/refresh path and middleware feature-flag pull
//     (Phase B will revisit `proxy.ts` cache + this fetch)
//   - the startup ping
//   - all Next route handlers under `app/api/**/route.ts` (Phase C will
//     revisit them)
//
// The scanner is a conservative line-based parser: it strips line and
// block comments and string/template literals while preserving line
// numbers, then matches `\bfetch\s*\(`. This avoids false positives from
// the word "fetch" appearing inside a comment or a string literal while
// still surfacing real call sites with accurate file:line in failures.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = new URL("../../../src", import.meta.url).pathname;

// Files allowed to call `fetch` directly. Paths are POSIX-style relative
// to `apps/web/src/`. Adding to this list requires reviewer sign-off
// (each entry must be a deliberate network boundary, not a workaround).
const ALLOWLIST: readonly string[] = [
	// the abstraction itself
	"lib/api-client.ts",
	// server-only Worker client (Key A injection)
	"lib/forum-api.ts",
	// NextAuth login/refresh — sits below the abstraction
	"auth.ts",
	// middleware feature-flag pull (Phase B target)
	"proxy.ts",
	// startup health ping
	"instrumentation.ts",
];

const ALLOWED_PREFIXES: readonly string[] = [
	// All Next.js route handlers — server boundary, Phase C target.
	"app/api/",
];

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

function isAllowed(relPosix: string): boolean {
	if (ALLOWLIST.includes(relPosix)) return true;
	for (const prefix of ALLOWED_PREFIXES) {
		if (relPosix.startsWith(prefix) && relPosix.endsWith("/route.ts")) return true;
	}
	return false;
}

function isCandidateFile(relPosix: string): boolean {
	if (!relPosix.endsWith(".ts") && !relPosix.endsWith(".tsx")) return false;
	if (relPosix.endsWith(".d.ts")) return false;
	if (TEST_FILE_RE.test(relPosix)) return false;
	if (TEST_BASENAME_RE.test(relPosix)) return false;
	return true;
}

/**
 * Strip line/block comments and single/double-quoted string literals while
 * preserving line numbers (replace stripped chars with spaces; keep
 * newlines). This way a regex match's line number maps back to the
 * original file faithfully.
 *
 * Template literals are intentionally NOT stripped: `${fetch('/x')}` is
 * a real call site and the guard must catch it. The trade-off is that a
 * literal token like `` `the word fetch( is documented here` `` would
 * false-positive, but Phase A's goal is "no raw fetch escapes the
 * abstraction", so we prefer false positives over false negatives. Such
 * a literal can be split or reworded to silence the guard.
 *
 * Conservative: this is not a TS parser. If a false positive ever
 * appears, fix it by splitting/rewording the literal or by moving the
 * network call into an allowlisted server boundary — never by adding
 * an inline silencing comment (Phase A explicitly does not allow
 * inline bypass mechanisms).
 */
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

const FETCH_RE = /\bfetch\s*\(/g;

function findRawFetchLines(stripped: string): number[] {
	const lines: number[] = [];
	const all = stripped.split("\n");
	for (let idx = 0; idx < all.length; idx += 1) {
		const line = all[idx];
		FETCH_RE.lastIndex = 0;
		if (FETCH_RE.test(line)) {
			lines.push(idx + 1);
		}
	}
	return lines;
}

describe("architecture: Phase A — no raw fetch in apps/web/src", () => {
	it("only allowlisted files may call fetch() directly", async () => {
		const violations: { file: string; lines: number[] }[] = [];

		for await (const abs of walk(SRC_ROOT)) {
			const rel = toPosix(relative(SRC_ROOT, abs));
			if (!isCandidateFile(rel)) continue;
			if (isAllowed(rel)) continue;

			const src = await readFile(abs, "utf8");
			const stripped = stripCommentsAndStrings(src);
			const hits = findRawFetchLines(stripped);
			if (hits.length > 0) {
				violations.push({ file: rel, lines: hits });
			}
		}

		if (violations.length > 0) {
			const message = [
				"Phase A network-layer guard: client raw fetch(...) is forbidden.",
				"All browser/component/hook/viewmodel network calls MUST go through",
				"`@/lib/forum-browser-api` (preferred) or `@/lib/api-client` (low-level).",
				"To add a server-boundary file to the allowlist, edit",
				"apps/web/tests/unit/architecture/no-raw-fetch.test.ts and document why",
				"in the same PR/commit. Reviewer sign-off required.",
				"",
				"Violations:",
				...violations.map((v) => `  - apps/web/src/${v.file}:${v.lines.join(",")}`),
			].join("\n");
			expect.fail(message);
		}
	});
});
