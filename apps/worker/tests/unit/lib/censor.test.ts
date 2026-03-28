import { describe, expect, it } from "bun:test";
import { applyCensorFilter, checkCensorWords } from "../../../src/lib/censor";
import { createMockDb, makeEnv } from "../../helpers";

// ─── helpers ───────────────────────────────────────────────

function makeCensorRow(
	overrides?: Partial<{ id: number; find: string; replacement: string; action: string }>,
) {
	return {
		id: 1,
		find: "badword",
		replacement: "***",
		action: "replace",
		...overrides,
	};
}

function makeEnvWithCensorRows(rows: unknown[]) {
	const { db } = createMockDb({
		allResults: {
			"SELECT id, find, replacement, action FROM censor_words": rows,
		},
	});
	return makeEnv({ DB: db });
}

// ─── checkCensorWords ──────────────────────────────────────

describe("checkCensorWords", () => {
	it("should return matched: false when no rules exist in DB", async () => {
		const env = makeEnvWithCensorRows([]);
		const result = await checkCensorWords("hello world", env);
		expect(result.matched).toBe(false);
		expect(result.action).toBeNull();
		expect(result.matches).toHaveLength(0);
		expect(result.filtered).toBeNull();
	});

	it("should match plain text and return replace action", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "badword", replacement: "***", action: "replace" }),
		]);
		const result = await checkCensorWords("this has a badword in it", env);
		expect(result.matched).toBe(true);
		expect(result.action).toBe("replace");
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].found).toBe("badword");
		expect(result.matches[0].word.id).toBe(1);
		expect(result.filtered).toBe("this has a *** in it");
	});

	it("should match regex patterns (e.g. /pattern/)", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 2, find: "/b[a4]dw[o0]rd/", replacement: "***", action: "replace" }),
		]);
		const result = await checkCensorWords("this has b4dw0rd in it", env);
		expect(result.matched).toBe(true);
		expect(result.action).toBe("replace");
		expect(result.matches[0].found).toBe("b4dw0rd");
		expect(result.filtered).toBe("this has *** in it");
	});

	it("should prioritize ban action over replace", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "spam", replacement: "***", action: "replace" }),
			makeCensorRow({ id: 2, find: "banned", replacement: "", action: "ban" }),
		]);
		const result = await checkCensorWords("this has spam and banned content", env);
		expect(result.matched).toBe(true);
		expect(result.action).toBe("ban");
		expect(result.matches).toHaveLength(2);
		expect(result.filtered).toBeNull();
	});

	it("should match case-insensitively", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "badword", replacement: "***", action: "replace" }),
		]);
		const result = await checkCensorWords("This has BADWORD in it", env);
		expect(result.matched).toBe(true);
		expect(result.matches[0].found).toBe("BADWORD");
		expect(result.filtered).toBe("This has *** in it");
	});

	it("should skip invalid regex patterns without crashing", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "/[invalid(/", replacement: "***", action: "replace" }),
			makeCensorRow({ id: 2, find: "good", replacement: "nice", action: "replace" }),
		]);
		const result = await checkCensorWords("this is good stuff", env);
		expect(result.matched).toBe(true);
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].word.id).toBe(2);
		expect(result.filtered).toBe("this is nice stuff");
	});

	it("should return multiple matches", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "bad", replacement: "***", action: "replace" }),
			makeCensorRow({ id: 2, find: "ugly", replacement: "pretty", action: "replace" }),
		]);
		const result = await checkCensorWords("bad and ugly", env);
		expect(result.matched).toBe(true);
		expect(result.matches).toHaveLength(2);
		expect(result.filtered).toBe("*** and pretty");
	});

	it("should return matched: false when content does not match any rules", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "badword", replacement: "***", action: "replace" }),
		]);
		const result = await checkCensorWords("perfectly clean content", env);
		expect(result.matched).toBe(false);
		expect(result.action).toBeNull();
		expect(result.matches).toHaveLength(0);
	});

	it("should handle plain text with special regex characters", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "price: $100", replacement: "***", action: "replace" }),
		]);
		// The $ should be escaped when treated as plain text
		const result = await checkCensorWords("the price: $100 is too high", env);
		expect(result.matched).toBe(true);
		expect(result.matches[0].found).toBe("price: $100");
		expect(result.filtered).toBe("the *** is too high");
	});
});

// ─── applyCensorFilter ─────────────────────────────────────

describe("applyCensorFilter", () => {
	it("should return original content when no matches", async () => {
		const env = makeEnvWithCensorRows([]);
		const result = await applyCensorFilter("hello world", env);
		expect(result.content).toBe("hello world");
		expect(result.banned).toBe(false);
	});

	it("should return filtered content for replace matches", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "badword", replacement: "***", action: "replace" }),
		]);
		const result = await applyCensorFilter("this has a badword", env);
		expect(result.content).toBe("this has a ***");
		expect(result.banned).toBe(false);
	});

	it("should return banned: true for ban matches", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "banned", replacement: "", action: "ban" }),
		]);
		const result = await applyCensorFilter("this is banned content", env);
		expect(result.banned).toBe(true);
	});

	it("should return banned: true when both ban and replace matches exist", async () => {
		const env = makeEnvWithCensorRows([
			makeCensorRow({ id: 1, find: "mild", replacement: "***", action: "replace" }),
			makeCensorRow({ id: 2, find: "severe", replacement: "", action: "ban" }),
		]);
		const result = await applyCensorFilter("mild and severe content", env);
		expect(result.banned).toBe(true);
	});
});
