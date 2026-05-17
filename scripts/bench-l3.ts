#!/usr/bin/env bun
/**
 * Autoresearch bench harness for L3 coverage growth.
 *
 * Strategy:
 *   - Run the forum-side L3 suite via scripts/run-l3.ts (owns server lifecycle).
 *   - Use Playwright's JSON reporter (PLAYWRIGHT_JSON_OUTPUT_NAME) to capture
 *     a structured report.
 *   - Emit METRIC lines that the autoresearch harness can parse.
 *
 * Primary metric:
 *   passing_l3 — number of L3 tests that ended in "passed".
 *
 * Hard gates (encoded as non-zero exit when violated):
 *   - No test ended in "failed" / "timedOut".
 *   - Report file produced.
 *
 * We intentionally do NOT run admin L3 here — the admin runner depends on a
 * separately-managed dev server on :7032 and would make every bench iteration
 * 2× slower. Admin spec changes can be sanity-checked with run-l3-admin.ts
 * manually before keeping.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REPORT = resolve(ROOT, ".autoresearch/l3-report.json");

mkdirSync(dirname(REPORT), { recursive: true });
if (existsSync(REPORT)) rmSync(REPORT, { force: true, recursive: true });

const env = {
	...process.env,
	// JSON reporter writes here when set; otherwise it goes to stdout.
	PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT,
};

// run-l3.ts forwards any extra CLI args to playwright. We add the JSON
// reporter alongside the default html (line reporter still shows progress).
// IMPORTANT: inherit stdio. With piped stdio the dev server logs every
// request and quickly fills the OS pipe buffer (bun spawnSync drains lazily),
// which causes the child to block on `console.log` and eventually time out
// every test. Inheriting forwards directly to our parent (run_experiment),
// which streams output without back-pressure.
spawnSync(
	"bun",
	["run", "scripts/run-l3.ts", "--reporter=list,json"],
	{ stdio: "inherit", env, cwd: ROOT },
);

if (!existsSync(REPORT)) {
	console.error("\n[bench-l3] No playwright JSON report produced — failing.");
	process.exit(2);
}

let report: any;
try {
	report = JSON.parse(readFileSync(REPORT, "utf-8"));
} catch (e) {
	console.error("[bench-l3] Failed to parse JSON report:", e);
	process.exit(2);
}

let passed = 0;
let failed = 0;
let flaky = 0;
let skipped = 0;
let total = 0;
const failedTitles: string[] = [];

function walk(node: any, trail: string[] = []) {
	if (!node) return;
	const here = node.title ? [...trail, node.title] : trail;
	if (Array.isArray(node.suites)) for (const s of node.suites) walk(s, here);
	if (Array.isArray(node.specs)) {
		for (const spec of node.specs) {
			for (const t of spec.tests ?? []) {
				total++;
				const results = t.results ?? [];
				const last = results[results.length - 1];
				const status = last?.status ?? "unknown";
				if (status === "skipped") {
					skipped++;
				} else if (spec.ok && status === "passed") {
					passed++;
					if (results.length > 1) flaky++;
				} else {
					failed++;
					failedTitles.push(`${[...here, spec.title].join(" › ")} [${status}]`);
				}
			}
		}
	}
}

walk(report);

if (failedTitles.length) {
	console.log("\n[bench-l3] failures:");
	for (const t of failedTitles.slice(0, 30)) console.log("  ✘", t);
	if (failedTitles.length > 30) console.log(`  ... and ${failedTitles.length - 30} more`);
}

console.log(
	`\n[bench-l3] total=${total} passed=${passed} failed=${failed} skipped=${skipped} flaky=${flaky}`,
);
console.log(`METRIC passing_l3=${passed}`);
console.log(`METRIC failing_l3=${failed}`);
console.log(`METRIC skipped_l3=${skipped}`);
console.log(`METRIC total_l3=${total}`);
console.log(`METRIC flaky_l3=${flaky}`);

if (failed > 0) {
	console.error(`[bench-l3] ${failed} test(s) failed.`);
	// Do NOT exit with non-zero here — the autoresearch loop tracks both
	// `passing_l3` (primary, maximise) and `failing_l3` (secondary, must not
	// regress). A hard exit would hide useful signal from the harness and
	// short-circuit the checks step. The autoresearch operator decides keep
	// vs discard based on both metrics.
}
if (passed === 0) {
	console.error(`[bench-l3] no tests passed — runner failure.`);
	process.exit(1);
}
process.exit(0);
