#!/usr/bin/env bun
/**
 * scripts/audit-l2-coverage.ts
 *
 * Phase 1B — deterministic L2 coverage matrix generator.
 *
 * Goal: produce the canonical (route × method) denominator and the L2 hit
 * status for every Worker endpoint, so that the "L2 100% API coverage"
 * target has a single, reproducible source of truth.
 *
 * Inputs (filesystem only — no network, no test execution):
 *   - apps/worker/src/index.ts       : route table (denominator)
 *   - tests/integration/http/**    : L2 test calls (numerator)
 *   - tests/integration/setup.ts     : helper → method mapping (declared
 *                                     here, validated by name only)
 *
 * Outputs:
 *   - stdout: human-readable summary (counts + uncovered list)
 *   - --write : also rewrites docs/18-l2-coverage-matrix.md atomically
 *
 * Exit code: 0 on success, 1 if --strict-coverage is set and any non-exempt
 * (route × method) is uncovered.
 *
 * Usage:
 *   bun run scripts/audit-l2-coverage.ts            # print + exit 0
 *   bun run scripts/audit-l2-coverage.ts --write    # rewrite the markdown
 *   bun run scripts/audit-l2-coverage.ts --strict-coverage   # gate mode
 *
 * The parser is intentionally restrictive: it only accepts the three exact
 * shapes that apps/worker/src/index.ts uses today, plus the same-line
 * `request.method === "..."` check:
 *
 *   Shape A: if (path === "<literal>" && request.method === "<METHOD>") {
 *   Shape B: if (path.match(/<regex>/) && request.method === "<METHOD>") {
 *   Shape C: const m = path.match(/<regex>/);
 *            if (m && request.method === "<METHOD>") {
 *
 * Anything else (e.g. method-less guards, 405 fallbacks) is ignored — those
 * are not routes. If the router file adopts a new shape, this script will
 * under-count and the diff will fail review; that is the desired loud
 * failure.
 *
 * L2 calls (numerator) are recognized in two forms:
 *
 *   1. Helper calls — workerFetch / workerPost / adminGet / ... per the
 *      HELPER_METHOD map below. Helper name implies the HTTP method.
 *
 *   2. Raw `fetch(...)` to the Worker — e.g.
 *        fetch("http://localhost:8787/api/...", init?)
 *        fetch(`${getWorkerUrl()}/api/...`, init?)
 *        fetch(`${WORKER_URL}/api/...`, init?)
 *      Default method is GET; an `init` literal with `method: "POST" | ...`
 *      overrides it. Only the literal `localhost:8787` prefix and the two
 *      known template helpers are recognized — external URLs and non-Worker
 *      fetches are deliberately ignored. Raw-fetch scanning is restricted
 *      to tests/integration/http/** to avoid false positives.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Configuration ────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const ROUTER_FILE = resolve(REPO_ROOT, "apps/worker/src/index.ts");
const L2_TEST_DIR = resolve(REPO_ROOT, "tests/integration/http");
const L2_FAST_DIR = resolve(REPO_ROOT, "tests/integration/fast");
const MATRIX_DOC = resolve(REPO_ROOT, "docs/18-l2-coverage-matrix.md");

/**
 * Helper-name → HTTP method mapping. Mirrors tests/integration/setup.ts.
 * Validated by name only (we don't statically verify the helper bodies);
 * if anyone adds a new helper there, add a row here in the same commit.
 */
const HELPER_METHOD: Record<string, string> = {
	// Public API helpers (Key A)
	workerFetch: "GET",
	workerAuthFetch: "GET", // default; init.method override handled below
	workerPost: "POST",
	workerPatch: "PATCH",
	workerDelete: "DELETE",
	// Admin API helpers (Key B)
	adminFetch: "GET",
	adminGet: "GET",
	adminPost: "POST",
	adminPatch: "PATCH",
	adminPut: "PUT",
	adminDelete: "DELETE",
};

/**
 * Routes that are intentionally NOT counted toward "100% API coverage".
 * Each entry MUST list a reason. Empty list = no exemptions (the default).
 */
const EXEMPTIONS: Array<{ method: string; pattern: string; reason: string }> = [
	// no exemptions today
];

// ─── Types ────────────────────────────────────────────────────────

interface Route {
	method: string;
	/** Literal path (for `path === "..."`) or pattern source (for `path.match(/.../)`). */
	pattern: string;
	/** "literal" or "regex". */
	kind: "literal" | "regex";
	/** Compiled RegExp for matching test calls. */
	regex: RegExp;
	/** Source line number (1-based) in apps/worker/src/index.ts. */
	line: number;
}

interface L2Call {
	helper: string;
	method: string;
	/** Path string as written in the test (may contain `${expr}` placeholders). */
	rawPath: string;
	/** Same path with placeholders replaced by `:param`. */
	templatePath: string;
	file: string;
	line: number;
}

// ─── Router parser ────────────────────────────────────────────────

function parseRouter(): Route[] {
	const src = readFileSync(ROUTER_FILE, "utf8");
	const lines = src.split("\n");
	const routes: Route[] = [];

	// Pre-pass: track `const VAR = path.match(/regex/);` assignments so
	// Shape C below can resolve the corresponding `if (VAR && request.method
	// === "...")` block. We don't try to enforce scope — names are reused
	// rarely enough in this router file that the latest assignment always
	// wins; if shadowing ever becomes a problem we'll add a depth check.
	const matchAssign = new Map<string, { patternSrc: string; line: number }>();
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^\s*const\s+(\w+)\s*=\s*path\.match\(\/(.+?)\/\)\s*;?\s*$/);
		if (m) matchAssign.set(m[1], { patternSrc: m[2], line: i + 1 });
	}

	// Collapse multi-line `if (\n   path...\n   && request.method === "..."\n)`
	// into single-line equivalents anchored at the `if (` line, so both
	// single-line and split-line router shapes are recognized uniformly.
	const collapsed: { text: string; line: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!/^\s*if \(/.test(line)) continue;
		// Walk forward until we balance the parenthesis count, joining lines.
		let buf = line.trim();
		let depth = countDelta(buf, "(", ")");
		let j = i;
		while (depth > 0 && j + 1 < lines.length) {
			j += 1;
			buf += ` ${lines[j].trim()}`;
			depth += countDelta(lines[j], "(", ")");
		}
		collapsed.push({ text: buf, line: i + 1 });
	}

	for (const { text, line } of collapsed) {
		// Shape A: if (path === "/api/..." && request.method === "<METHOD>") {
		const litMatch = text.match(
			/^if \(\s*path === "([^"]+)"\s*&&\s*request\.method === "([A-Z]+)"\s*\)/,
		);
		if (litMatch) {
			const pattern = litMatch[1];
			const method = litMatch[2];
			routes.push({
				method,
				pattern,
				kind: "literal",
				regex: new RegExp(`^${escapeRegExp(pattern)}$`),
				line,
			});
			continue;
		}

		// Shape B: if (path.match(/REGEX/) && request.method === "<METHOD>") {
		const reMatch = text.match(
			/^if \(\s*path\.match\(\/(.+?)\/\)\s*&&\s*request\.method === "([A-Z]+)"\s*\)/,
		);
		if (reMatch) {
			const patternSrc = reMatch[1];
			const method = reMatch[2];
			routes.push({
				method,
				pattern: `/${patternSrc}/`,
				kind: "regex",
				regex: new RegExp(patternSrc),
				line,
			});
			continue;
		}

		// Shape C: const VAR = path.match(/REGEX/);
		//          if (VAR && request.method === "<METHOD>") {
		// Used in apps/worker/src/index.ts:267-268 (post-images) where the
		// match result is reused inside the body via captured groups.
		const varMatch = text.match(/^if \(\s*(\w+)\s*&&\s*request\.method === "([A-Z]+)"\s*\)/);
		if (varMatch) {
			const varName = varMatch[1];
			const method = varMatch[2];
			const assigned = matchAssign.get(varName);
			if (!assigned) continue;
			routes.push({
				method,
				pattern: `/${assigned.patternSrc}/`,
				kind: "regex",
				regex: new RegExp(assigned.patternSrc),
				line,
			});
		}
	}

	// De-dupe on (method, pattern) — the router shouldn't have dupes, but
	// guard anyway so the count is canonical.
	const seen = new Set<string>();
	const deduped: Route[] = [];
	for (const r of routes) {
		const key = `${r.method} ${r.pattern}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(r);
	}
	return deduped;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count net `(` minus `)` outside string/regex literals (best-effort). */
function countDelta(line: string, open: string, close: string): number {
	let n = 0;
	for (const ch of line) {
		if (ch === open) n += 1;
		else if (ch === close) n -= 1;
	}
	return n;
}

// ─── L2 test scanner ──────────────────────────────────────────────

function listFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		if (name.endsWith(".test.ts")) out.push(join(dir, name));
	}
	return out.sort();
}

function listTestFiles(): string[] {
	return listFiles(L2_TEST_DIR);
}

function listFastFiles(): string[] {
	// L2-fast specs: tests/integration/fast/**/*.fast.test.ts
	return listFiles(L2_FAST_DIR).filter((f) => f.endsWith(".fast.test.ts"));
}

function parseCalls(files: string[], layer: "http" | "fast"): L2Call[] {
	const calls: L2Call[] = [];
	const helperUnion = Object.keys(HELPER_METHOD).join("|");
	// http: workerPost("/api/v1/threads", ...); fast: workerFetch(env, "/api/...", ...)
	// We capture the first string literal/template that starts with "/" so both
	// signatures work.
	const callRe = new RegExp(
		`\\b(${helperUnion})\\s*\\(\\s*(?:\\w+\\s*,\\s*)?([\`"'])(\\/[^\`"']*)\\2([^)]*)`,
		"g",
	);
	const rawFetchRe =
		/\bfetch\s*\(\s*([`"'])(?:http:\/\/localhost:(?:8787|17031)|\$\{(?:getWorkerUrl\(\)|WORKER_URL)\})(\/[^`"'\s]*)\1([^)]*)/g;
	const methodOverrideRe = /\bmethod\s*:\s*["']([A-Z]+)["']/;

	for (const file of files) {
		const src = readFileSync(file, "utf8");
		const lines = src.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			callRe.lastIndex = 0;
			let m: RegExpExecArray | null = callRe.exec(line);
			while (m) {
				const helper = m[1];
				const rawPath = m[3];
				const trailing = m[4] ?? "";
				let method = HELPER_METHOD[helper];
				const lookahead = [
					trailing,
					lines[i + 1] ?? "",
					lines[i + 2] ?? "",
					lines[i + 3] ?? "",
				].join(" ");
				const ov = lookahead.match(methodOverrideRe);
				if (ov) method = ov[1];
				const templatePath = templatize(rawPath);
				calls.push({
					helper: `${helper}@${layer}`,
					method,
					rawPath,
					templatePath,
					file: file.replace(`${REPO_ROOT}/`, ""),
					line: i + 1,
				});
				m = callRe.exec(line);
			}

			rawFetchRe.lastIndex = 0;
			let rm: RegExpExecArray | null = rawFetchRe.exec(line);
			while (rm) {
				const rawPath = rm[2];
				const trailing = rm[3] ?? "";
				let method = "GET";
				const lookahead = [
					trailing,
					lines[i + 1] ?? "",
					lines[i + 2] ?? "",
					lines[i + 3] ?? "",
				].join(" ");
				const ov = lookahead.match(methodOverrideRe);
				if (ov) method = ov[1];
				const templatePath = templatize(rawPath);
				calls.push({
					helper: `fetch@${layer}`,
					method,
					rawPath,
					templatePath,
					file: file.replace(`${REPO_ROOT}/`, ""),
					line: i + 1,
				});
				rm = rawFetchRe.exec(line);
			}
		}
	}
	return calls;
}

/**
 * Replace `${...}` template substitutions with `:param` and strip query
 * strings. The result is suitable for matching against route regexes.
 */
function templatize(rawPath: string): string {
	const noQuery = rawPath.split("?")[0];
	return noQuery.replace(/\$\{[^}]+\}/g, ":param");
}

// ─── Matching ─────────────────────────────────────────────────────

function matchCallToRoute(call: L2Call, routes: Route[]): Route | null {
	// Build a candidate concrete path: replace `:param` with a benign sample
	// for each route's expectation. We try the path as-is against literal
	// routes (after substituting `:param` to numbers for regex routes).
	for (const r of routes) {
		if (r.method !== call.method) continue;
		if (r.kind === "literal") {
			if (call.templatePath === r.pattern) return r;
		} else {
			// regex route: substitute :param with a numeric stand-in (most
			// path params in this router are \d+).
			const probe = call.templatePath.replace(/:param/g, "1");
			if (r.regex.test(probe)) return r;
			// Fall back to a non-numeric stand-in for routes like /me/...
			const altProbe = call.templatePath.replace(/:param/g, "abc");
			if (r.regex.test(altProbe)) return r;
		}
	}
	return null;
}

// ─── Reporting ────────────────────────────────────────────────────

interface CoverageReport {
	routes: Route[];
	totalRoutes: number;
	hitRoutes: Route[];
	missRoutes: Route[];
	exempt: typeof EXEMPTIONS;
	calls: L2Call[];
	unmatchedCalls: L2Call[];
}

function parseL2Calls(): L2Call[] {
	return [...parseCalls(listTestFiles(), "http"), ...parseCalls(listFastFiles(), "fast")];
}

function buildReport(): CoverageReport {
	const routes = parseRouter();
	const calls = parseL2Calls();

	const hits = new Set<string>();
	const unmatched: L2Call[] = [];
	for (const c of calls) {
		const r = matchCallToRoute(c, routes);
		if (r) hits.add(`${r.method} ${r.pattern}`);
		else unmatched.push(c);
	}

	const hitRoutes = routes.filter((r) => hits.has(`${r.method} ${r.pattern}`));
	const missRoutes = routes.filter((r) => !hits.has(`${r.method} ${r.pattern}`));

	return {
		routes,
		totalRoutes: routes.length,
		hitRoutes,
		missRoutes,
		exempt: EXEMPTIONS,
		calls,
		unmatchedCalls: unmatched,
	};
}

function printSummary(rep: CoverageReport): void {
	const methodCounts: Record<string, number> = {};
	for (const r of rep.routes) {
		methodCounts[r.method] = (methodCounts[r.method] ?? 0) + 1;
	}
	const methodOrder = ["GET", "POST", "PATCH", "PUT", "DELETE"];
	const methodLine = methodOrder
		.filter((m) => methodCounts[m])
		.map((m) => `${m} ${methodCounts[m]}`)
		.join(" / ");

	console.log("L2 route × method coverage audit");
	console.log("─".repeat(60));
	console.log(`Router file       : ${ROUTER_FILE.replace(`${REPO_ROOT}/`, "")}`);
	console.log(
		"Test glob         : tests/integration/http/*.test.ts + tests/integration/fast/*.fast.test.ts",
	);
	console.log(`Total routes      : ${rep.totalRoutes}`);
	console.log(`Method breakdown  : ${methodLine}`);
	const fastCalls = rep.calls.filter((c) => c.helper.endsWith("@fast")).length;
	const httpCalls = rep.calls.length - fastCalls;
	console.log(`L2 calls scanned  : ${rep.calls.length} (http=${httpCalls}, fast=${fastCalls})`);
	console.log(`Routes hit        : ${rep.hitRoutes.length}`);
	console.log(`Routes uncovered  : ${rep.missRoutes.length}`);
	console.log(`Exemptions        : ${rep.exempt.length}`);
	console.log(`Unmatched calls   : ${rep.unmatchedCalls.length}`);
	console.log("");
	if (rep.missRoutes.length) {
		console.log("Uncovered (method, pattern):");
		for (const r of rep.missRoutes) {
			console.log(`  - ${r.method.padEnd(6)} ${r.pattern}    (index.ts:${r.line})`);
		}
	}
	if (rep.unmatchedCalls.length) {
		console.log("");
		console.log("Calls not matched to any route (likely router-shape change):");
		for (const c of rep.unmatchedCalls.slice(0, 20)) {
			console.log(`  - ${c.method.padEnd(6)} ${c.templatePath}    (${c.file}:${c.line})`);
		}
		if (rep.unmatchedCalls.length > 20) {
			console.log(`  … and ${rep.unmatchedCalls.length - 20} more`);
		}
	}
}

function renderMarkdown(rep: CoverageReport): string {
	// Local-date stamp (YYYY-MM-DD) so the matrix's "Last audit" line matches
	// the operator's wall clock and Slock thread timestamps. Using
	// toISOString() would skew by up to a calendar day for non-UTC zones.
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const date = `${yyyy}-${mm}-${dd}`;
	const methodCounts: Record<string, number> = {};
	for (const r of rep.routes) {
		methodCounts[r.method] = (methodCounts[r.method] ?? 0) + 1;
	}
	const methodOrder = ["GET", "POST", "PATCH", "PUT", "DELETE"];
	const methodLine = methodOrder
		.filter((m) => methodCounts[m])
		.map((m) => `${m} ${methodCounts[m]}`)
		.join(" / ");
	const pct = rep.totalRoutes
		? ((rep.hitRoutes.length / rep.totalRoutes) * 100).toFixed(2)
		: "0.00";

	const lines: string[] = [];
	lines.push("# 18 — L2 Route × Method Coverage Matrix");
	lines.push("");
	lines.push("> **Generated by `scripts/audit-l2-coverage.ts`. Do not edit by hand.**");
	lines.push("> Re-run with `bun run scripts/audit-l2-coverage.ts --write` after any change");
	lines.push(
		"> to `apps/worker/src/index.ts`, `tests/integration/http/*.test.ts`, or `tests/integration/fast/*.fast.test.ts`.",
	);
	lines.push("");
	lines.push(`Last audit: **${date}**`);
	lines.push("");
	lines.push("## 1. Summary");
	lines.push("");
	lines.push("| Metric | Value |");
	lines.push("|---|---|");
	lines.push(`| Total (route × method) | **${rep.totalRoutes}** |`);
	lines.push(`| Method breakdown | ${methodLine} |`);
	lines.push(`| L2 calls scanned | ${rep.calls.length} |`);
	lines.push(`| Routes hit | **${rep.hitRoutes.length}** (${pct}%) |`);
	lines.push(`| Routes uncovered | **${rep.missRoutes.length}** |`);
	lines.push(`| Exemptions | ${rep.exempt.length} |`);
	lines.push(`| Unmatched test calls | ${rep.unmatchedCalls.length} |`);
	lines.push("");
	lines.push("## 2. Parser contract");
	lines.push("");
	lines.push("Routes are extracted from `apps/worker/src/index.ts` using three");
	lines.push("regex shapes:");
	lines.push("");
	lines.push("```");
	lines.push('if (path === "<literal>" && request.method === "<METHOD>") {');
	lines.push('if (path.match(/<regex>/) && request.method === "<METHOD>") {');
	lines.push("const m = path.match(/<regex>/);");
	lines.push('if (m && request.method === "<METHOD>") {');
	lines.push("```");
	lines.push("");
	lines.push("Method-less guards (e.g. CORS preflight `OPTIONS`, the");
	lines.push("validateApiKey middleware, the maintenance gate) are intentionally");
	lines.push("**not** counted as routes.");
	lines.push("");
	lines.push("L2 calls are recognized in two forms:");
	lines.push("");
	lines.push("1. **Helper calls** — the helper map declared at the top of the");
	lines.push("   script (mirrors `tests/integration/setup.ts`):");
	lines.push("");
	for (const [helper, method] of Object.entries(HELPER_METHOD)) {
		lines.push(`   - \`${helper}\` → ${method}`);
	}
	lines.push("");
	lines.push("2. **Raw `fetch(...)` to the Worker** — calls of the form");
	lines.push('   `fetch("http://localhost:8787/api/...", init?)` or');
	lines.push("   `fetch(`${getWorkerUrl()}/api/...`, init?)` (also");
	lines.push("   `${WORKER_URL}`). Default method is `GET`; an `init` object with");
	lines.push('   `method: "POST" | "PATCH" | ...` overrides it. Only the literal');
	lines.push("   `localhost:8787` prefix and the two known template helpers are");
	lines.push("   recognized — external URLs and non-Worker `fetch` calls are");
	lines.push("   ignored. Scanning for raw fetches is restricted to");
	lines.push("   `tests/integration/http/**` to avoid false positives.");
	lines.push("");
	lines.push("Test paths with `${...}` template substitutions are rewritten to");
	lines.push("`:param` and matched against literal routes verbatim or against");
	lines.push("regex routes by substituting `:param` with `1` (numeric path");
	lines.push("params) or `abc` (string path params), in that order.");
	lines.push("");
	lines.push("## 3. Exemptions");
	lines.push("");
	if (rep.exempt.length === 0) {
		lines.push("_None._ Every route × method must be covered by L2.");
	} else {
		lines.push("| Method | Pattern | Reason |");
		lines.push("|---|---|---|");
		for (const e of rep.exempt) {
			lines.push(`| ${e.method} | \`${e.pattern}\` | ${e.reason} |`);
		}
	}
	lines.push("");
	lines.push("## 4. Coverage matrix");
	lines.push("");
	lines.push("| Status | Method | Pattern | Source line |");
	lines.push("|---|---|---|---|");
	const sorted = [...rep.routes].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "literal" ? -1 : 1;
		if (a.pattern < b.pattern) return -1;
		if (a.pattern > b.pattern) return 1;
		return a.method.localeCompare(b.method);
	});
	const hits = new Set(rep.hitRoutes.map((r) => `${r.method} ${r.pattern}`));
	for (const r of sorted) {
		const status = hits.has(`${r.method} ${r.pattern}`) ? "✅" : "❌";
		lines.push(`| ${status} | ${r.method} | \`${r.pattern}\` | index.ts:${r.line} |`);
	}
	lines.push("");
	lines.push("## 5. Uncovered queue (Phase 4 backlog)");
	lines.push("");
	if (rep.missRoutes.length === 0) {
		lines.push("_All routes covered._ 🎉");
	} else {
		lines.push("| Method | Pattern | Source line |");
		lines.push("|---|---|---|");
		for (const r of rep.missRoutes) {
			lines.push(`| ${r.method} | \`${r.pattern}\` | index.ts:${r.line} |`);
		}
	}
	lines.push("");
	lines.push("## 6. Unmatched L2 calls");
	lines.push("");
	lines.push("Test calls that point at a path the router doesn't recognize. A non-zero");
	lines.push("count usually means the router file changed shape and this script");
	lines.push("needs a new parser branch (or a test points at a stale URL).");
	lines.push("");
	if (rep.unmatchedCalls.length === 0) {
		lines.push("_None._");
	} else {
		lines.push("| Method | Path (templated) | Test file:line |");
		lines.push("|---|---|---|");
		for (const c of rep.unmatchedCalls) {
			lines.push(`| ${c.method} | \`${c.templatePath}\` | ${c.file}:${c.line} |`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────

function main(): void {
	const args = new Set(process.argv.slice(2));
	const write = args.has("--write");
	const strict = args.has("--strict-coverage");

	const rep = buildReport();
	printSummary(rep);

	if (write) {
		const md = renderMarkdown(rep);
		writeFileSync(MATRIX_DOC, md);
		console.log("");
		console.log(`Wrote ${MATRIX_DOC.replace(`${REPO_ROOT}/`, "")}`);
	}

	if (strict) {
		const exemptKeys = new Set(rep.exempt.map((e) => `${e.method} ${e.pattern}`));
		const failing = rep.missRoutes.filter((r) => !exemptKeys.has(`${r.method} ${r.pattern}`));
		// Unmatched calls are also a hard fail under strict mode: a non-zero
		// count means a test is hitting a path the parser can't resolve, so
		// the matrix is no longer authoritative — treat that as a gate break.
		if (failing.length > 0 || rep.unmatchedCalls.length > 0) {
			if (failing.length > 0) {
				console.error(`\n❌ --strict-coverage: ${failing.length} non-exempt route(s) uncovered.`);
			}
			if (rep.unmatchedCalls.length > 0) {
				console.error(
					`❌ --strict-coverage: ${rep.unmatchedCalls.length} L2 call(s) unmatched — matrix is not authoritative.`,
				);
			}
			process.exit(1);
		}
	}
}

main();
