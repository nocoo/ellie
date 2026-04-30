#!/usr/bin/env node
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
// Audit test files for low-meaning patterns:
//  - tests with 0 expect() calls
//  - tests with only weak smoke assertions (typeof checks, .toBeDefined)
//  - DUPLICATE test BODIES within the same file (whitespace-normalized)
import { readFileSync } from "node:fs";

const files = execSync('find apps packages tests -name "*.test.ts" -not -path "*/node_modules/*"', {
	encoding: "utf8",
})
	.trim()
	.split("\n")
	.filter(Boolean);

let totalTests = 0;
let noAssert = 0;
let weakSmoke = 0;
let dupBodies = 0;
const offenders = [];

for (const f of files) {
	const src = readFileSync(f, "utf8");
	const re2 = /\b(it|test)\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*(?:async\s*)?\(?\)?\s*=>\s*\{/g;
	// Track describe nesting via line scan
	const describes = [...src.matchAll(/\bdescribe\s*(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g)].map((m) => ({
		name: m[2],
		pos: m.index,
	}));
	const blocks = [];
	let m;
	while ((m = re2.exec(src))) {
		const start = m.index + m[0].length;
		let depth = 1;
		let i = start;
		while (i < src.length && depth > 0) {
			const ch = src[i++];
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
		}
		const body = src.slice(start, i - 1);
		const norm = body.replace(/\s+/g, " ").trim();
		const hash = createHash("md5").update(norm).digest("hex").slice(0, 12);
		// Find the nearest describe before this `it`
		let describeName = "";
		for (const d of describes) {
			if (d.pos < m.index) describeName = d.name;
			else break;
		}
		blocks.push({ name: m[3], body, norm, hash, describe: describeName });
	}
	totalTests += blocks.length;
	const seen = new Map();
	for (const b of blocks) {
		const expects = (b.body.match(/\bexpect\s*\(/g) || []).length;
		if (expects === 0) {
			noAssert++;
			offenders.push(`${f}: NO_ASSERT > ${b.name}`);
		} else {
			const meaningful = (
				b.body.match(
					/\.toBe\(|\.toEqual\(|\.toBeNull\(|\.toBeFalsy\(|\.toBeTruthy\(|\.toContain\(|\.toMatch\(|\.toHaveBeen\w+\(|\.toThrow\w*\(|\.toBeGreater\w*\(|\.toBeLess\w*\(|\.toHaveLength\(|\.rejects\.|\.resolves\./g,
				) || []
			).length;
			const weakOnly = (
				b.body.match(
					/\.toBeDefined\(\)|\.toBe\(("boolean"|"string"|"number"|"object"|"function")\)/g,
				) || []
			).length;
			if (expects > 0 && meaningful === 0 && weakOnly > 0) {
				weakSmoke++;
				offenders.push(`${f}: WEAK > ${b.name}`);
			}
		}
		// only count as duplicate if non-trivial body (>40 chars normalized) and SAME describe context
		if (b.norm.length > 40) {
			const key = `${b.describe}::${b.hash}`;
			if (seen.has(key)) {
				dupBodies++;
				offenders.push(`${f}: DUP_BODY[${b.describe}] > ${seen.get(key)} == ${b.name}`);
			} else {
				seen.set(key, b.name);
			}
		}
	}
}

const meaningless = noAssert + weakSmoke + dupBodies;
console.error(
	`audit: ${totalTests} tests, ${noAssert} no-assert, ${weakSmoke} weak-smoke, ${dupBodies} dup-bodies`,
);
if (process.argv.includes("-v")) {
	for (const o of offenders) console.error(`  ${o}`);
}
console.log(`METRIC test_count=${totalTests}`);
console.log(`METRIC no_assert_count=${noAssert}`);
console.log(`METRIC weak_smoke_count=${weakSmoke}`);
console.log(`METRIC dup_body_count=${dupBodies}`);
console.log(`METRIC meaningless_test_count=${meaningless}`);
