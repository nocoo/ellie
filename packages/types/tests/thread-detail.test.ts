import { describe, expect, it } from "vitest";
import { encodeGenericCursor } from "../src/pagination";
import {
	decodeThreadDetailCursor,
	parseThreadDetailContextRequest,
	THREAD_DETAIL_CONTEXT_PATH,
	THREAD_DETAIL_MESSAGES,
	threadDetailSelection,
} from "../src/thread-detail";

const request = {
	threadId: 7,
	limit: 20,
	cursor: null,
	last: false,
	cachedRevision: null,
	includeDisplay: true,
	includeStats: false,
};

describe("thread detail context contract", () => {
	it("freezes the route and accepts a cold request", () => {
		expect(THREAD_DETAIL_CONTEXT_PATH).toBe("/api/v1/threads/context");
		expect(parseThreadDetailContextRequest(request)).toEqual({ ok: true, value: request });
	});

	it("accepts a strict position cursor and a warm revision", () => {
		const cursor = encodeGenericCursor({ position: 20 });
		const warm = {
			...request,
			cursor,
			cachedRevision: "a".repeat(64),
			includeDisplay: false,
			includeStats: true,
		};
		expect(parseThreadDetailContextRequest(warm)).toEqual({ ok: true, value: warm });
		expect(decodeThreadDetailCursor(cursor)).toBe(20);
	});

	it("rejects last together with a cursor", () => {
		expect(
			parseThreadDetailContextRequest({
				...request,
				last: true,
				cursor: encodeGenericCursor({ position: 1 }),
			}),
		).toEqual({ ok: false, message: THREAD_DETAIL_MESSAGES.invalidCursor });
	});

	it.each([null, undefined, [], "request", 4])("rejects malformed body %j", (body) => {
		expect(parseThreadDetailContextRequest(body).ok).toBe(false);
	});

	it("requires every field and rejects unknown fields", () => {
		for (const key of Object.keys(request)) {
			const body = { ...request } as Record<string, unknown>;
			delete body[key];
			expect(parseThreadDetailContextRequest(body).ok).toBe(false);
		}
		expect(parseThreadDetailContextRequest({ ...request, userId: 5 })).toEqual({
			ok: false,
			message: THREAD_DETAIL_MESSAGES.unknownField,
		});
	});

	it.each([
		["threadId", 0],
		["threadId", "7"],
		["limit", 0],
		["limit", 101],
		["limit", 1.5],
		["cursor", 20],
		["cursor", encodeGenericCursor({ position: -1 })],
		["cursor", encodeGenericCursor({ position: 1, id: 2 } as never)],
		["last", 1],
		["cachedRevision", "abc"],
		["cachedRevision", "A".repeat(64)],
		["includeDisplay", 1],
		["includeStats", null],
	])("rejects invalid %s", (key, value) => {
		expect(parseThreadDetailContextRequest({ ...request, [key]: value }).ok).toBe(false);
	});

	it("builds one selection for the latest page and another for a forward cursor", () => {
		expect(threadDetailSelection(7, 20, null, false)).toBe(
			"thread:7:limit:20:cursor:start:mode:forward",
		);
		expect(threadDetailSelection(7, 20, 40, true)).toBe("thread:7:limit:20:cursor:start:mode:last");
		expect(threadDetailSelection(7, 20, 40, false)).toBe(
			"thread:7:limit:20:cursor:40:mode:forward",
		);
	});
});
