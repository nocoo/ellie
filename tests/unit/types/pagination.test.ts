import {
	type CursorPayload,
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	clampPageSize,
	decodeCursor,
	decodeGenericCursor,
	encodeCursor,
	encodeGenericCursor,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// encodeCursor / decodeCursor (legacy CursorPayload shape)
// ---------------------------------------------------------------------------

describe("encodeCursor / decodeCursor", () => {
	it("round-trips a valid payload", () => {
		const payload: CursorPayload = { sortValue: 1234567890, id: 42 };
		const encoded = encodeCursor(payload);
		const decoded = decodeCursor(encoded);
		expect(decoded).toEqual(payload);
	});

	it("returns null for invalid base64", () => {
		expect(decodeCursor("!!!invalid-base64!!!")).toBeNull();
	});

	it("returns null for valid base64 but invalid JSON", () => {
		expect(decodeCursor(btoa("not-json"))).toBeNull();
	});

	it("returns null for JSON without required fields", () => {
		expect(decodeCursor(btoa(JSON.stringify({ foo: "bar" })))).toBeNull();
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: 123 })))).toBeNull();
		expect(decodeCursor(btoa(JSON.stringify({ id: 123 })))).toBeNull();
	});

	it("returns null for wrong field types", () => {
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: "str", id: 1 })))).toBeNull();
		expect(decodeCursor(btoa(JSON.stringify({ sortValue: 1, id: "str" })))).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// encodeGenericCursor / decodeGenericCursor
// ---------------------------------------------------------------------------

describe("encodeGenericCursor / decodeGenericCursor", () => {
	interface PostCursor {
		position: number;
	}

	interface ThreadCursor {
		sticky: number;
		lastPostAt: number;
		id: number;
	}

	it("round-trips a PostCursor payload", () => {
		const payload: PostCursor = { position: 42 };
		const encoded = encodeGenericCursor(payload);
		const decoded = decodeGenericCursor<PostCursor>(encoded, (p) => typeof p.position === "number");
		expect(decoded).toEqual(payload);
	});

	it("round-trips a ThreadCursor payload", () => {
		const payload: ThreadCursor = { sticky: 0, lastPostAt: 1234567890, id: 123 };
		const encoded = encodeGenericCursor(payload);
		const decoded = decodeGenericCursor<ThreadCursor>(
			encoded,
			(p) =>
				typeof p.sticky === "number" &&
				typeof p.lastPostAt === "number" &&
				typeof p.id === "number",
		);
		expect(decoded).toEqual(payload);
	});

	it("returns null for invalid base64", () => {
		const decoded = decodeGenericCursor<PostCursor>("!!!", () => true);
		expect(decoded).toBeNull();
	});

	it("returns null when validator rejects", () => {
		const encoded = encodeGenericCursor({ position: "not-a-number" });
		const decoded = decodeGenericCursor<PostCursor>(encoded, (p) => typeof p.position === "number");
		expect(decoded).toBeNull();
	});

	it("returns null for non-object JSON values", () => {
		expect(decodeGenericCursor(btoa("123"), () => true)).toBeNull();
		expect(decodeGenericCursor(btoa('"string"'), () => true)).toBeNull();
		expect(decodeGenericCursor(btoa("null"), () => true)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// clampPageSize
// ---------------------------------------------------------------------------

describe("clampPageSize", () => {
	it("returns DEFAULT_PAGE_SIZE for undefined", () => {
		expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
	});

	it("returns DEFAULT_PAGE_SIZE for 0 or negative", () => {
		expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
		expect(clampPageSize(-1)).toBe(DEFAULT_PAGE_SIZE);
	});

	it("returns the value when within range", () => {
		expect(clampPageSize(1)).toBe(1);
		expect(clampPageSize(25)).toBe(25);
		expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
	});

	it("clamps values above MAX_PAGE_SIZE", () => {
		expect(clampPageSize(100)).toBe(MAX_PAGE_SIZE);
		expect(clampPageSize(1000)).toBe(MAX_PAGE_SIZE);
	});
});
