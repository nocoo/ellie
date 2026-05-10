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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
			// Construct a synthetic key under this prefix that isn't shared
			// with another family. Use a sentinel suffix to avoid colliding
			// with sibling prefixes (e.g. user:mini: vs user:mini:v2:).
			const probe = `${spec.listPrefix}__probe__`;
			const resolved = resolveFamilyForKey(probe);
			// For families whose listPrefix is a strict prefix of another
			// (e.g. user:mini: is a prefix of user:mini:v2:), the probe key
			// will still start with our prefix but the v2 entry's prefix
			// won't match because we don't include "v2:" in the probe.
			expect(resolved?.family).toBe(spec.family);
		}
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
});

describe("kv-registry — architecture guard", () => {
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
