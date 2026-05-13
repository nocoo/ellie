// JsonCodeBlock — token kind classification + class-token pin guard.
//
// We don't render to the DOM here; we lock the tokenizer behaviour and
// pin the visual color tokens via source inspection (same convention as
// section-header.test.ts / segmented-switch.test.ts). The tokenizer is
// the only piece with non-trivial logic — if a future refactor breaks
// key/value distinction or whitespace preservation, these assertions
// fail before a regression hits the KV monitor page.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokenizeJson } from "../../../src/components/admin/json-code-block";

describe("tokenizeJson", () => {
	it("distinguishes object keys from string values via the trailing colon", () => {
		const pretty = JSON.stringify({ name: "alice" }, null, 2);
		const tokens = tokenizeJson(pretty);
		const keys = tokens.filter((t) => t.kind === "key").map((t) => t.text);
		const strings = tokens.filter((t) => t.kind === "string").map((t) => t.text);
		expect(keys).toEqual(['"name"']);
		expect(strings).toEqual(['"alice"']);
	});

	it("classifies numbers, booleans, null, and structural punctuation", () => {
		const pretty = JSON.stringify({ n: 42, ok: true, gone: null, arr: [1] }, null, 2);
		const tokens = tokenizeJson(pretty);
		const kinds = new Set(tokens.map((t) => t.kind));
		expect(kinds.has("number")).toBe(true);
		expect(kinds.has("boolean")).toBe(true);
		expect(kinds.has("null")).toBe(true);
		expect(kinds.has("punct")).toBe(true);
		// Booleans: only "true" / "false" should land in the boolean bucket.
		expect(tokens.find((t) => t.text === "true")?.kind).toBe("boolean");
		expect(tokens.find((t) => t.text === "null")?.kind).toBe("null");
		expect(tokens.find((t) => t.text === "42")?.kind).toBe("number");
	});

	it("preserves whitespace as plain tokens so JSON indentation survives", () => {
		const pretty = JSON.stringify({ a: 1 }, null, 2);
		const tokens = tokenizeJson(pretty);
		// Reconstructing tokens MUST round-trip the input exactly.
		expect(tokens.map((t) => t.text).join("")).toBe(pretty);
		// At least one indentation gap should land in the "plain" bucket.
		const plainHasNewline = tokens.some((t) => t.kind === "plain" && /\n/.test(t.text));
		expect(plainHasNewline).toBe(true);
	});

	it("does not mis-tokenize escaped quotes inside string values", () => {
		const pretty = JSON.stringify({ note: 'has "quote"' }, null, 2);
		const tokens = tokenizeJson(pretty);
		// One key, one string — no extra fragments from the escaped quote.
		expect(tokens.filter((t) => t.kind === "key")).toHaveLength(1);
		expect(tokens.filter((t) => t.kind === "string")).toHaveLength(1);
	});

	it("handles negative numbers and exponents", () => {
		const pretty = JSON.stringify({ x: -1.5e10 }, null, 2);
		const tokens = tokenizeJson(pretty);
		const num = tokens.find((t) => t.kind === "number");
		expect(num?.text).toBe("-15000000000");
	});
});

const SOURCE = readFileSync(
	fileURLToPath(new URL("../../../src/components/admin/json-code-block.tsx", import.meta.url)),
	"utf8",
);

describe("JsonCodeBlock — pinned class tokens", () => {
	it("uses the agreed color tokens for each JSON kind", () => {
		// Keys: blue (light + dark)
		expect(SOURCE).toContain("text-blue-600");
		expect(SOURCE).toContain("dark:text-blue-400");
		// Strings: emerald
		expect(SOURCE).toContain("text-emerald-600");
		expect(SOURCE).toContain("dark:text-emerald-400");
		// Numbers: amber
		expect(SOURCE).toContain("text-amber-600");
		// Boolean / null: purple
		expect(SOURCE).toContain("text-purple-600");
		// Punctuation: muted
		expect(SOURCE).toContain("text-muted-foreground");
	});

	it("uses code-block container tokens (mono, muted bg, scroll, height cap)", () => {
		expect(SOURCE).toContain("font-mono");
		expect(SOURCE).toContain("bg-background");
		expect(SOURCE).toContain("overflow-auto");
		expect(SOURCE).toContain("max-w-full");
		expect(SOURCE).toContain("max-h-[60vh]");
	});

	it("preserves JSON indentation with whitespace-pre and only wraps plain strings", () => {
		// JSON path: whitespace-pre (no wrap, breaks layers otherwise)
		expect(SOURCE).toContain("whitespace-pre");
		// Plain-string path: wrap + break-all
		expect(SOURCE).toContain("whitespace-pre-wrap");
		expect(SOURCE).toContain("break-all");
	});
});
