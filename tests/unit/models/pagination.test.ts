import { describe, expect, test } from "bun:test";
import {
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	clampPageSize,
	decodeCursor,
	encodeCursor,
} from "@/models/pagination";

// ─── encodeCursor / decodeCursor ────────────────────────

describe("encodeCursor", () => {
	test("returns a non-empty string", () => {
		const cursor = encodeCursor({ sortValue: 1000, id: 42 });
		expect(typeof cursor).toBe("string");
		expect(cursor.length).toBeGreaterThan(0);
	});

	test("different payloads produce different cursors", () => {
		const a = encodeCursor({ sortValue: 1000, id: 1 });
		const b = encodeCursor({ sortValue: 1000, id: 2 });
		expect(a).not.toBe(b);
	});
});

describe("decodeCursor", () => {
	test("roundtrip: encode then decode", () => {
		const payload = { sortValue: 1709312400, id: 12345 };
		const cursor = encodeCursor(payload);
		const decoded = decodeCursor(cursor);
		expect(decoded).toEqual(payload);
	});

	test("handles zero values", () => {
		const payload = { sortValue: 0, id: 0 };
		const cursor = encodeCursor(payload);
		expect(decodeCursor(cursor)).toEqual(payload);
	});

	test("handles negative sortValue", () => {
		const payload = { sortValue: -100, id: 5 };
		const cursor = encodeCursor(payload);
		expect(decodeCursor(cursor)).toEqual(payload);
	});

	test("invalid base64 → null", () => {
		expect(decodeCursor("not-valid-base64!!!")).toBeNull();
	});

	test("valid base64 but invalid JSON → null", () => {
		expect(decodeCursor(btoa("not json"))).toBeNull();
	});

	test("valid JSON but missing sortValue → null", () => {
		expect(decodeCursor(btoa(JSON.stringify({ id: 1 })))).toBeNull();
	});

	test("valid JSON but missing id → null", () => {
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: 100 })))).toBeNull();
	});

	test("valid JSON but wrong types → null", () => {
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: "abc", id: 1 })))).toBeNull();
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: 1, id: "abc" })))).toBeNull();
	});

	test("empty string → null", () => {
		expect(decodeCursor("")).toBeNull();
	});
});

// ─── clampPageSize ──────────────────────────────────────

describe("clampPageSize", () => {
	test("undefined → DEFAULT_PAGE_SIZE", () => {
		expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
	});

	test("0 → DEFAULT_PAGE_SIZE", () => {
		expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
	});

	test("negative → DEFAULT_PAGE_SIZE", () => {
		expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
	});

	test("within range → pass through", () => {
		expect(clampPageSize(10)).toBe(10);
		expect(clampPageSize(1)).toBe(1);
		expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
	});

	test("exceeds max → clamped to MAX_PAGE_SIZE", () => {
		expect(clampPageSize(100)).toBe(MAX_PAGE_SIZE);
		expect(clampPageSize(999)).toBe(MAX_PAGE_SIZE);
	});
});
