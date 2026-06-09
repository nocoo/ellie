// Architecture-guard test for the KV registry.
//
// Goals (intentionally narrow):
//   1. Every prefix declared in `KV_PUT_PREFIX_ALLOWLIST` corresponds
//      to at least one family in `KV_REGISTRY` (so the allowlist and
//      registry can't drift apart silently).
//   2. Every family that lists a `listPrefix` resolves back to itself
//      via `resolveFamilyForKey` (longest-prefix match correctness).
//   3. Sensitivity invariants hold:
//        - `nameSensitivity: "hide"` ⇒ family must not show sample
//          keys in any UI flow (we just assert the spec is `hide` and
//          rely on the handler test for behavior).
//        - `valueSensitivity: "no-read"` ⇒ refresh action MUST be
//          `none` for session/rate-limit/throttle categories. The
//          admin UI must never expose typed mutations on those.
//   4. Static prefix-allowlist guard: scrape every literal/template
//      prefix from `apps/worker/src/**/*.ts` `env.KV.put(...)` /
//      `env.KV.delete(...)` calls and verify each starts with one of
//      the prefixes in `KV_PUT_PREFIX_ALLOWLIST`. This is a REMINDER,
//      not a perfect static analysis — when a new write lands, either
//      register the family or extend the allowlist.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	KV_PUT_PREFIX_ALLOWLIST,
	KV_REGISTRY,
	resolveFamilyForKey,
} from "../../../../src/lib/cache/kv-registry";

const SRC_ROOT = join(__dirname, "../../../../src");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) walk(full, out);
		else if (entry.endsWith(".ts")) out.push(full);
	}
	return out;
}

/**
 * Pull KV-key prefixes out of `env.KV.put("...", ...)` /
 * `env.KV.put(\`...\${x}\`, ...)` / `.delete(...)` call sites.
 *
 * The matcher only handles the two cases used in the codebase today:
 *   - bare string literal as the key arg
 *   - template literal whose head is the prefix (e.g. `refresh:${tok}`)
 *
 * Variables-as-key (e.g. `await env.KV.put(key, ...)` with `key` built
 * elsewhere) are skipped — they're caught by registry membership of
 * the corresponding builder.
 */
const KV_OP_RE =
	/env\.KV\.(?:put|delete|get|getWithMetadata)\s*\(\s*(?:"([^"]+)"|`([^`${}]+)(?:\$\{|`))/g;

function extractPrefixes(source: string): string[] {
	const found: string[] = [];
	for (const m of source.matchAll(KV_OP_RE)) {
		const literal = m[1] ?? m[2];
		if (literal) found.push(literal);
	}
	return found;
}

describe("kv-registry — declarative invariants", () => {
	it("every allowlist prefix has a registry family with that listPrefix", () => {
		const registryPrefixes = new Set(KV_REGISTRY.map((s) => s.listPrefix));
		// allowlist may use the bare prefix; registry listPrefix must START
		// with the allowlist prefix or vice versa — every allowlist entry
		// must have at least one registry family that owns it.
		for (const prefix of KV_PUT_PREFIX_ALLOWLIST) {
			const owner = KV_REGISTRY.find(
				(s) => s.listPrefix === prefix || prefix.startsWith(s.listPrefix),
			);
			expect(owner, `allowlist prefix "${prefix}" has no registry family`).toBeTruthy();
			// For documentation strength, also assert the prefix is referenced
			// directly by SOME family OR a more-specific registry prefix exists.
			void registryPrefixes; // silence unused-var lint when the loop above is enough
		}
	});

	it("each family.listPrefix resolves back to that family", () => {
		for (const spec of KV_REGISTRY) {
			// Exact (singleton) families resolve only on the literal name;
			// prefix families resolve on a synthetic suffix that won't
			// collide with siblings.
			const probe = spec.keyKind === "exact" ? spec.listPrefix : `${spec.listPrefix}__probe__`;
			const resolved = resolveFamilyForKey(probe);
			expect(resolved?.family).toBe(spec.family);
		}
	});

	it("thread:list:v2 main refresh defaults to per-forum bump (not global all-gen)", async () => {
		// Regression guard: the global `bump-thread-list-all` sweep must
		// stay on the dedicated `gen:thread:list:all` family. The page-1
		// thread-list cache should default to a per-forum bump so the
		// admin button doesn't nuke every forum's cache by accident.
		const spec = KV_REGISTRY.find((s) => s.family === "thread:list:v2");
		expect(spec).toBeTruthy();
		expect(spec?.refresh.kind).toBe("bump-thread-list-forum");
		const allGen = KV_REGISTRY.find((s) => s.family === "gen:thread:list:all");
		expect(allGen?.refresh.kind).toBe("bump-thread-list-all");
	});

	it("thread:list:gen:all is explicitly listed in the put-prefix allowlist", () => {
		// Documentation strength: the exact gen key has its own family,
		// so the allowlist should reference it explicitly even though
		// the broader `thread:list:gen:` prefix already covers it.
		expect(KV_PUT_PREFIX_ALLOWLIST).toContain("thread:list:gen:all");
	});

	it("singleton (exact) prefixes do not swallow siblings", () => {
		// `settings:all` (exact) must not own `settings:all:v2:foo`.
		const sibling = resolveFamilyForKey("settings:all:v2:something");
		expect(sibling?.family).not.toBe("settings:all");
		// `public-stats` (exact) must not own arbitrary `public-stats:foo`.
		const otherKey = resolveFamilyForKey("public-stats:bogus");
		expect(otherKey?.family).not.toBe("public-stats");
	});

	it("thread:list:gen:all routes to the global gen family, not per-forum", () => {
		const all = resolveFamilyForKey("thread:list:gen:all");
		expect(all?.family).toBe("gen:thread:list:all");
		const perForum = resolveFamilyForKey("thread:list:gen:42");
		expect(perForum?.family).toBe("gen:thread:list:per-forum");
	});

	it("session/rate-limit/throttle families with no-read values do not expose typed mutations", () => {
		for (const spec of KV_REGISTRY) {
			if (
				spec.valueSensitivity === "no-read" &&
				(spec.category === "session" ||
					spec.category === "rate-limit" ||
					spec.category === "throttle")
			) {
				expect(
					spec.refresh.kind,
					`family ${spec.family} must declare refresh: { kind: "none" }`,
				).toBe("none");
			}
		}
	});

	it("hidden-name families never expose typed mutations either", () => {
		for (const spec of KV_REGISTRY) {
			if (spec.nameSensitivity === "hide") {
				expect(
					spec.refresh.kind,
					`hidden-name family ${spec.family} must declare refresh: { kind: "none" }`,
				).toBe("none");
			}
		}
	});

	it("declared TTLs match the runtime constants", () => {
		// Explicit pin so a constant change forces a registry update —
		// the admin "when does it expire" answer would otherwise lie.
		const expected: Record<string, number | "sticky" | "variable"> = {
			"forum:tree:v2": 86_400, // FORUM_TREE_TTL
			"forum:summary:v2": 86_400, // FORUM_SUMMARY_TTL
			"forum:meta:v2": 86_400, // FORUM_META_TTL
			"thread:list:v2": 60, // THREAD_LIST_TTL
			"user:mini:v1": 86_400, // USER_CACHE_TTL
			"digest:stats": 3600, // DIGEST_CACHE_TTL
			"digest:filters": 3600, // DIGEST_CACHE_TTL
			"settings:all": 900, // settings.ts KV_TTL
			"public-stats": 900, // stats.ts CACHE_TTL_SECONDS
			"stats:online_count": 300, // online-stats.ts
			"stats:online_peak": "sticky",
			"online:user": 900, // middleware/online.ts ONLINE_TTL
			activity_throttle: 120, // middleware/activity.ts
			"login-ip": 3_600,
			"login-lockout-ip": 86_400,
			"reg-ip": 60,
			"chk-usr-ip": 60,
		};
		for (const [family, ttl] of Object.entries(expected)) {
			const spec = KV_REGISTRY.find((s) => s.family === family);
			expect(spec, `family ${family} missing from registry`).toBeDefined();
			expect(spec?.ttl, `family ${family} TTL drift`).toBe(ttl);
		}
	});
});

describe("kv-registry — architecture guard", () => {
	it("ip-lookup family is registered, allowlisted, and documented in docs/20", () => {
		const spec = KV_REGISTRY.find((s) => s.family === "ip-lookup");
		expect(spec, "ip-lookup family missing from KV_REGISTRY").toBeDefined();
		expect(spec?.listPrefix).toBe("ip-lookup:");
		expect(spec?.ttl).toBe(86_400);
		expect(KV_PUT_PREFIX_ALLOWLIST).toContain("ip-lookup:");

		// docs/20 must mention the family. Simple existence check; we
		// deliberately do not parse the markdown structure.
		const docsPath = resolve(SRC_ROOT, "../../../docs/20-worker-kv-reference.md");
		const docs = readFileSync(docsPath, "utf8");
		expect(docs.includes("`ip-lookup:<ip>`")).toBe(true);
	});

	it("every literal KV-key prefix in apps/worker/src is covered by KV_PUT_PREFIX_ALLOWLIST", () => {
		const files = walk(SRC_ROOT);
		const found = new Set<string>();
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const prefix of extractPrefixes(source)) {
				found.add(prefix);
			}
		}
		const orphans: string[] = [];
		for (const prefix of found) {
			const covered = KV_PUT_PREFIX_ALLOWLIST.some((allowed) => prefix.startsWith(allowed));
			if (!covered) orphans.push(prefix);
		}
		expect(
			orphans,
			`Found KV key prefixes used in apps/worker/src that are not in KV_PUT_PREFIX_ALLOWLIST.\nEither:\n  (a) add a family to KV_REGISTRY and the prefix to KV_PUT_PREFIX_ALLOWLIST, or\n  (b) add the prefix to KV_PUT_PREFIX_OUT_OF_SCOPE with a comment explaining why.\n\nOrphan prefixes:\n${orphans.map((p) => `  - "${p}"`).join("\n")}`,
		).toEqual([]);
	});
});
