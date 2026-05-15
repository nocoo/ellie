import {
	type ForumThreadTypesPublic,
	buildForumListReturnTo,
	buildForumListUrl,
	coerceTypeIdParam,
	mapCreateThreadTypeError,
	normalizeTypeId,
	shouldShowFilter,
	shouldShowPicker,
	shouldShowTypeNameBadge,
} from "@/viewmodels/forum/thread-types";
import type { ForumThreadType } from "@ellie/types";
import { describe, expect, it } from "vitest";

const t = (id: number, name: string): ForumThreadType => ({
	id,
	name,
	displayOrder: 0,
	icon: "",
	enabled: true,
	moderatorOnly: false,
});

const payload = (overrides: Partial<ForumThreadTypesPublic> = {}): ForumThreadTypesPublic => ({
	enabled: true,
	required: false,
	listable: true,
	prefix: true,
	types: [t(11, "求购"), t(12, "出售")],
	...overrides,
});

describe("thread-types viewmodel — pure helpers", () => {
	describe("coerceTypeIdParam", () => {
		it("returns null for null / undefined / empty / array", () => {
			expect(coerceTypeIdParam(null)).toBeNull();
			expect(coerceTypeIdParam(undefined)).toBeNull();
			expect(coerceTypeIdParam("")).toBeNull();
			expect(coerceTypeIdParam(["1", "2"])).toBeNull();
		});

		it("rejects 0, negative, decimals, signs, leading zeros, trailing junk", () => {
			expect(coerceTypeIdParam("0")).toBeNull();
			expect(coerceTypeIdParam("-1")).toBeNull();
			expect(coerceTypeIdParam("+1")).toBeNull();
			expect(coerceTypeIdParam("1.0")).toBeNull();
			expect(coerceTypeIdParam("01")).toBeNull();
			expect(coerceTypeIdParam("1abc")).toBeNull();
			expect(coerceTypeIdParam(" 1")).toBeNull();
			expect(coerceTypeIdParam("1 ")).toBeNull();
		});

		it("accepts positive integer strings", () => {
			expect(coerceTypeIdParam("1")).toBe(1);
			expect(coerceTypeIdParam("42")).toBe(42);
			expect(coerceTypeIdParam("123456")).toBe(123456);
		});
	});

	describe("normalizeTypeId — public payload whitelist", () => {
		it("returns null when typeId is null regardless of payload", () => {
			expect(normalizeTypeId(null, payload())).toBeNull();
		});

		it("returns null when payload is null", () => {
			expect(normalizeTypeId(11, null)).toBeNull();
		});

		it("returns null when enabled=false (master off)", () => {
			expect(normalizeTypeId(11, payload({ enabled: false }))).toBeNull();
		});

		it("returns null when listable=false (filter UI off)", () => {
			expect(normalizeTypeId(11, payload({ listable: false }))).toBeNull();
		});

		it("returns null when typeId not in types[] (stale / disabled / cross-forum)", () => {
			expect(normalizeTypeId(99, payload())).toBeNull();
		});

		it("returns the typeId when it matches an enabled row", () => {
			expect(normalizeTypeId(11, payload())).toBe(11);
			expect(normalizeTypeId(12, payload())).toBe(12);
		});
	});

	describe("shouldShowFilter", () => {
		it("hides when payload null", () => {
			expect(shouldShowFilter(null)).toBe(false);
		});

		it("hides when enabled=false", () => {
			expect(shouldShowFilter(payload({ enabled: false }))).toBe(false);
		});

		it("hides when listable=false", () => {
			expect(shouldShowFilter(payload({ listable: false }))).toBe(false);
		});

		it("hides when types[] empty", () => {
			expect(shouldShowFilter(payload({ types: [] }))).toBe(false);
		});

		it("shows when enabled && listable && types.length > 0", () => {
			expect(shouldShowFilter(payload())).toBe(true);
		});
	});

	describe("shouldShowPicker", () => {
		it("hides when payload null / enabled=false / types empty", () => {
			expect(shouldShowPicker(null)).toBe(false);
			expect(shouldShowPicker(payload({ enabled: false }))).toBe(false);
			expect(shouldShowPicker(payload({ types: [] }))).toBe(false);
		});

		it("shows when enabled && types.length > 0 regardless of listable", () => {
			expect(shouldShowPicker(payload({ listable: false }))).toBe(true);
			expect(shouldShowPicker(payload())).toBe(true);
		});
	});

	describe("shouldShowTypeNameBadge", () => {
		it("returns true when payload is null (no config = default visible)", () => {
			expect(shouldShowTypeNameBadge(null)).toBe(true);
		});

		it("returns false when prefix switch is off", () => {
			expect(shouldShowTypeNameBadge(payload({ prefix: false }))).toBe(false);
		});

		it("returns true when prefix switch is on", () => {
			expect(shouldShowTypeNameBadge(payload({ prefix: true }))).toBe(true);
		});

		it("ignores enabled/listable — only `prefix` controls badge visibility", () => {
			expect(
				shouldShowTypeNameBadge(payload({ prefix: true, enabled: false, listable: false })),
			).toBe(true);
		});
	});

	describe("buildForumListUrl", () => {
		it("returns base path with no params on page 1 and no typeId", () => {
			expect(buildForumListUrl({ forumId: 134 })).toBe("/forums/134");
			expect(buildForumListUrl({ forumId: 134, page: 1 })).toBe("/forums/134");
		});

		it("emits ?page=N for page > 1", () => {
			expect(buildForumListUrl({ forumId: 134, page: 3 })).toBe("/forums/134?page=3");
		});

		it("emits ?typeId=N when typeId positive", () => {
			expect(buildForumListUrl({ forumId: 134, typeId: 11 })).toBe("/forums/134?typeId=11");
		});

		it("omits typeId for null / undefined / 0 (no-filter sentinel)", () => {
			expect(buildForumListUrl({ forumId: 134, typeId: null })).toBe("/forums/134");
			expect(buildForumListUrl({ forumId: 134, typeId: undefined })).toBe("/forums/134");
			expect(buildForumListUrl({ forumId: 134, typeId: 0 })).toBe("/forums/134");
		});

		it("emits both page and typeId in stable order", () => {
			expect(buildForumListUrl({ forumId: 134, page: 4, typeId: 11 })).toBe(
				"/forums/134?page=4&typeId=11",
			);
		});
	});

	describe("buildForumListReturnTo", () => {
		it("delegates to buildForumListUrl (same shape)", () => {
			expect(buildForumListReturnTo({ forumId: 134, page: 2, typeId: 11 })).toBe(
				buildForumListUrl({ forumId: 134, page: 2, typeId: 11 }),
			);
		});
	});

	describe("mapCreateThreadTypeError", () => {
		it("returns null for null / undefined / non-object", () => {
			expect(mapCreateThreadTypeError(null)).toBeNull();
			expect(mapCreateThreadTypeError(undefined)).toBeNull();
			expect(mapCreateThreadTypeError(42)).toBeNull();
		});

		it("returns null when message is not present", () => {
			expect(mapCreateThreadTypeError({})).toBeNull();
			expect(mapCreateThreadTypeError({ code: "INVALID_BODY" })).toBeNull();
		});

		it("maps 'required type' family to 请选择主题分类", () => {
			expect(mapCreateThreadTypeError({ message: "thread type is required" })).toBe(
				"请选择主题分类",
			);
			expect(
				mapCreateThreadTypeError({
					details: { message: "分类为必选" },
				}),
			).toBe("请选择主题分类");
		});

		it("maps cross-forum mismatch", () => {
			expect(mapCreateThreadTypeError({ message: "thread type forum mismatch" })).toBe(
				"主题分类与当前版面不匹配，请重新选择",
			);
			expect(mapCreateThreadTypeError({ message: "分类不属于当前版面" })).toBe(
				"主题分类与当前版面不匹配，请重新选择",
			);
		});

		it("maps invalid / disabled / not-found type", () => {
			expect(mapCreateThreadTypeError({ message: "invalid type id" })).toBe(
				"主题分类不存在或已停用，请重新选择",
			);
			expect(mapCreateThreadTypeError({ message: "thread type disabled" })).toBe(
				"主题分类不存在或已停用，请重新选择",
			);
		});

		it("returns null for unrelated messages (caller falls back to generic)", () => {
			expect(mapCreateThreadTypeError({ message: "rate limited" })).toBeNull();
		});

		it("prefers details.message over top-level message", () => {
			// nested details wins when both are present (Worker shape)
			expect(
				mapCreateThreadTypeError({
					message: "INVALID_BODY",
					details: { message: "thread type is required" },
				}),
			).toBe("请选择主题分类");
		});
	});
});
