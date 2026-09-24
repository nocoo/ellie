import {
	boundMemoryCachePreview,
	isMemoryCacheAction,
	isMemoryCacheFamilyId,
	MEMORY_CACHE_ACTIONS,
	MEMORY_CACHE_ADMIN_HEADER,
	MEMORY_CACHE_ADMIN_PATH,
	MEMORY_CACHE_ERROR_CODES,
	MEMORY_CACHE_FAMILIES,
	MEMORY_CACHE_FAMILY_CAPACITY,
	MEMORY_CACHE_HISTORY_LIMIT,
	MEMORY_CACHE_HTTP_STATUS,
	MEMORY_CACHE_LIMIT_DEFAULT,
	MEMORY_CACHE_LIMIT_MAX,
	MEMORY_CACHE_MESSAGES,
	MEMORY_CACHE_PAGE_DEFAULT,
	MEMORY_CACHE_PAGE_MAX,
	MEMORY_CACHE_PAYLOAD_LIMIT_BYTES,
	MEMORY_CACHE_PREVIEW_MAX_BYTES,
	MEMORY_CACHE_TTL_MS,
	MEMORY_CACHE_WEB_PATH,
	memoryCacheError,
	memoryCacheErrorEnvelope,
	parseMemoryCacheMutation,
	parseMemoryCacheQuery,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

describe("memory cache management contract", () => {
	it("freezes routes, header, families, and capacities", () => {
		expect(MEMORY_CACHE_WEB_PATH).toBe("/api/internal/memory-cache");
		expect(MEMORY_CACHE_ADMIN_PATH).toBe("/api/admin/memory-cache");
		expect(MEMORY_CACHE_ADMIN_HEADER).toBe("X-Ellie-Memory-Key");
		expect(MEMORY_CACHE_FAMILIES).toEqual([
			"site-stats",
			"forum-summary",
			"thread-count",
			"home-display",
		]);
		expect(MEMORY_CACHE_ACTIONS).toEqual(["clear", "flush"]);
		expect(MEMORY_CACHE_FAMILY_CAPACITY).toEqual({
			"site-stats": 1,
			"forum-summary": 256,
			"thread-count": 1024,
			"home-display": 4,
		});
		expect(MEMORY_CACHE_PAYLOAD_LIMIT_BYTES).toBe(8 * 1024 * 1024);
		expect(MEMORY_CACHE_PREVIEW_MAX_BYTES).toBe(512);
		expect(MEMORY_CACHE_HISTORY_LIMIT).toBe(60);
		expect(MEMORY_CACHE_TTL_MS).toBe(300_000);
		expect(MEMORY_CACHE_HTTP_STATUS.INSTANCE_CONFLICT).toBe(409);
		expect(MEMORY_CACHE_HTTP_STATUS.UPSTREAM_UNAVAILABLE).toBe(502);
		expect(MEMORY_CACHE_ERROR_CODES).toContain("NOT_CONFIGURED");
	});

	it("recognizes only the frozen family and action ids", () => {
		expect(isMemoryCacheFamilyId("site-stats")).toBe(true);
		expect(isMemoryCacheFamilyId("forum-summary")).toBe(true);
		expect(isMemoryCacheFamilyId("thread-count")).toBe(true);
		expect(isMemoryCacheFamilyId("views")).toBe(false);
		expect(isMemoryCacheAction("clear")).toBe(true);
		expect(isMemoryCacheAction("flush")).toBe(true);
		expect(isMemoryCacheAction("drop")).toBe(false);
	});

	it("builds the shared error envelope", () => {
		expect(memoryCacheError("UNAUTHORIZED", MEMORY_CACHE_MESSAGES.unauthorized)).toEqual({
			code: "UNAUTHORIZED",
			message: "Unauthorized",
		});
		expect(memoryCacheErrorEnvelope("NOT_CONFIGURED", MEMORY_CACHE_MESSAGES.notConfigured)).toEqual(
			{
				error: {
					code: "NOT_CONFIGURED",
					message: MEMORY_CACHE_MESSAGES.notConfigured,
				},
			},
		);
	});
});

describe("parseMemoryCacheQuery", () => {
	it("defaults page and limit", () => {
		expect(parseMemoryCacheQuery(new URLSearchParams())).toEqual({
			ok: true,
			value: { page: MEMORY_CACHE_PAGE_DEFAULT, limit: MEMORY_CACHE_LIMIT_DEFAULT },
		});
	});

	it("accepts a known family and bounded page", () => {
		const parsed = parseMemoryCacheQuery(
			new URLSearchParams({ family: "thread-count", page: "2", limit: "100" }),
		);
		expect(parsed).toEqual({
			ok: true,
			value: { family: "thread-count", page: 2, limit: MEMORY_CACHE_LIMIT_MAX },
		});
	});

	it("rejects unknown, repeated, and invalid query values", () => {
		expect(parseMemoryCacheQuery(new URLSearchParams({ extra: "1" })).ok).toBe(false);
		const repeated = new URLSearchParams();
		repeated.append("page", "1");
		repeated.append("page", "2");
		expect(parseMemoryCacheQuery(repeated)).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", message: MEMORY_CACHE_MESSAGES.repeatedQuery },
		});
		expect(parseMemoryCacheQuery(new URLSearchParams({ family: "views" }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidFamily },
		});
		expect(parseMemoryCacheQuery(new URLSearchParams({ page: "0" }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidPage },
		});
		expect(parseMemoryCacheQuery(new URLSearchParams({ page: "01" }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidPage },
		});
		expect(
			parseMemoryCacheQuery(new URLSearchParams({ page: String(MEMORY_CACHE_PAGE_MAX + 1) })),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidPage } });
		expect(parseMemoryCacheQuery(new URLSearchParams({ page: "9".repeat(20) }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidPage },
		});
		expect(parseMemoryCacheQuery(new URLSearchParams({ limit: "0" }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidLimit },
		});
		expect(parseMemoryCacheQuery(new URLSearchParams({ limit: "101" }))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidLimit },
		});
	});
});

describe("parseMemoryCacheMutation", () => {
	const instanceId = "web-1";

	it("accepts flush and each clear scope", () => {
		expect(parseMemoryCacheMutation({ instanceId, action: "flush" })).toEqual({
			ok: true,
			value: { instanceId, action: "flush" },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "clear" })).toEqual({
			ok: true,
			value: { instanceId, action: "clear" },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "clear", family: "site-stats" })).toEqual(
			{
				ok: true,
				value: { instanceId, action: "clear", family: "site-stats" },
			},
		);
		expect(
			parseMemoryCacheMutation({
				instanceId,
				action: "clear",
				family: "forum-summary",
				key: "forum:9",
			}),
		).toEqual({
			ok: true,
			value: { instanceId, action: "clear", family: "forum-summary", key: "forum:9" },
		});
	});

	it("rejects non-objects, unknown fields, and invalid selectors", () => {
		expect(parseMemoryCacheMutation(null)).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidBody },
		});
		expect(parseMemoryCacheMutation([])).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidBody },
		});
		expect(parseMemoryCacheMutation("flush")).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidBody },
		});
		expect(parseMemoryCacheMutation(Object.create(null))).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidInstanceId },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "flush", drop: true })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.unknownField },
		});
		expect(parseMemoryCacheMutation({ instanceId: "", action: "flush" })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidInstanceId },
		});
		expect(parseMemoryCacheMutation({ instanceId: "bad id", action: "flush" })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidInstanceId },
		});
		expect(
			parseMemoryCacheMutation({ instanceId: `a${"b".repeat(128)}`, action: "flush" }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidInstanceId } });
		const foreign = Object.create({ inherited: true });
		expect(parseMemoryCacheMutation(foreign)).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidBody },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "drop" })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.unknownAction },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: 1 })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.unknownAction },
		});
		expect(
			parseMemoryCacheMutation({ instanceId, action: "clear", family: "views" }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidFamily } });
		expect(parseMemoryCacheMutation({ instanceId, action: "clear", family: 1 })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidFamily },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "clear", key: 1 })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidKey },
		});
		expect(parseMemoryCacheMutation({ instanceId, action: "clear", key: "" })).toMatchObject({
			error: { message: MEMORY_CACHE_MESSAGES.invalidKey },
		});
		expect(
			parseMemoryCacheMutation({ instanceId, action: "clear", key: "a".repeat(257) }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidKey } });
		expect(
			parseMemoryCacheMutation({ instanceId, action: "clear", key: "bad\nkey" }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidKey } });
		expect(
			parseMemoryCacheMutation({ instanceId, action: "clear", key: "bad\u007fkey" }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.invalidKey } });
		expect(
			parseMemoryCacheMutation({ instanceId, action: "clear", key: "only-key" }),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.keyRequiresFamily } });
		expect(
			parseMemoryCacheMutation({
				instanceId,
				action: "flush",
				family: "site-stats",
			}),
		).toMatchObject({ error: { message: MEMORY_CACHE_MESSAGES.flushRejectsSelector } });
		expect(parseMemoryCacheMutation({ instanceId, action: "flush", key: "forum:1" })).toMatchObject(
			{ error: { message: MEMORY_CACHE_MESSAGES.flushRejectsSelector } },
		);
	});
});

describe("boundMemoryCachePreview", () => {
	it("keeps short previews and trims on a UTF-8 boundary", () => {
		expect(boundMemoryCachePreview("views:3")).toBe("views:3");
		const wide = "测".repeat(200);
		const bounded = boundMemoryCachePreview(wide);
		expect(new TextEncoder().encode(bounded).byteLength).toBeLessThanOrEqual(
			MEMORY_CACHE_PREVIEW_MAX_BYTES,
		);
		expect(bounded.endsWith("测")).toBe(true);
		expect(bounded.length).toBeLessThan(wide.length);
		const ascii = "a".repeat(MEMORY_CACHE_PREVIEW_MAX_BYTES + 8);
		expect(boundMemoryCachePreview(ascii)).toHaveLength(MEMORY_CACHE_PREVIEW_MAX_BYTES);
	});
});
