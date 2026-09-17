import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KV_REGISTRY } from "../../../../src/lib/cache/kv-registry";

const sourceRoot = resolve(__dirname, "../../../../src");
const router = readFileSync(join(sourceRoot, "index.ts"), "utf8");
const docs = readFileSync(resolve(sourceRoot, "../../../docs/20-worker-kv-reference.md"), "utf8");
const reads = [
	...router.matchAll(
		/request\.method === "GET"\s*\)\s*\{\s*return await \(await import\("([^"]+)"\)\)\.(\w+)\(([^;]+)/g,
	),
];
const documented = [
	...docs.matchAll(
		/^\| `((?:handlers|lib)\/[^`]+)` \| `([^`]+)` \| (整份复用|部分复用|明确例外) \| ([^|]+) \| ([^|]+) \|$/gm,
	),
];

// Runtime state has separate semantics; these are ownership boundaries, not
// a claim that a regex can prove every indirect call in TypeScript is safe.
const rawKvOwners: Record<string, string> = {
	"handlers/auth.ts": "Login sessions, lockout and rate limiting",
	"handlers/email.ts": "Verification codes and send locks",
	"handlers/admin/kv.ts": "Bounded diagnosis and explicit management",
	"handlers/admin/user.ts": "Fresh online presence overlay",
	"lib/cache/store.ts": "Unified envelope I/O",
	"lib/cache/wrap.ts": "Unified coalescing and invalidation",
	"lib/cache/manage.ts": "Pure inspection and confirmed mutations",
	"lib/cache/epoch.ts": "Resource versions",
	"lib/cache/admin-monitor-read.ts": "Bounded metadata observations",
	"lib/cache/public-stats-read.ts": "Existing online-count signal",
	"lib/online-stats.ts": "Scheduled presence aggregation",
	"lib/stats-job.ts": "Runtime job progress",
	"lib/stats-rollover.ts": "Daily rollover state",
	"middleware/activity.ts": "Activity write throttle",
	"middleware/online.ts": "Online presence signal",
};

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
	});
}

describe("cache architecture boundaries", () => {
	it("documents every GET entry and forwards the execution context for cached reads", () => {
		// A new router shape must update this audit instead of silently evading it.
		expect(reads.length).toBe([...router.matchAll(/request\.method === "GET"/g)].length);
		const targets = reads.map((match) => `${match[1].replace(/^\.\//, "")}.${match[2]}`);
		expect(documented.map((row) => row[1]).sort()).toEqual([...targets].sort());
		for (const read of reads) {
			const target = `${read[1].replace(/^\.\//, "")}.${read[2]}`;
			const row = documented.find((entry) => entry[1] === target);
			if (!row) throw new Error(`Undocumented GET entry: ${target}`);
			expect(row[5].trim(), `${target} needs behavior evidence or an exception reason`).not.toBe(
				"",
			);
			if (row[3] === "明确例外") continue;
			expect(read[3], `${target} must forward ctx`).toMatch(/\bctx\b/);
			const families = [...row[4].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
			expect(families.length, `${target} must name its registered families`).toBeGreaterThan(0);
			for (const family of families) {
				const spec = KV_REGISTRY.find((entry) => entry.family === family);
				expect(spec?.status, `${target}: ${family}`).toBe("shipped");
				expect(spec?.tier, `${target}: ${family}`).toMatch(/^(SHORT|MEDIUM|LONG)$/);
			}
		}
	});

	it("keeps direct KV I/O inside the core and declared runtime-state owners", () => {
		const violations = sourceFiles(sourceRoot)
			.filter((file) => {
				const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
				return (
					/\.KV\.(?:get|getWithMetadata|put|delete|list)\s*\(/.test(source) &&
					!Object.hasOwn(rawKvOwners, relative(sourceRoot, file))
				);
			})
			.map((file) => relative(sourceRoot, file));
		expect(violations, "Business cache I/O must use the shared module").toEqual([]);
	});

	it("enrolls every shipped business family with one of the three tiers and a pure loader", () => {
		for (const spec of KV_REGISTRY.filter(
			(entry) => entry.status === "shipped" && entry.category === "cache",
		)) {
			expect(spec.tier, spec.family).toMatch(/^(SHORT|MEDIUM|LONG)$/);
			expect(spec.loader, spec.family).toBeTruthy();
		}
	});
});
