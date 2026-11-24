import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import {
	configFlagLabel,
	createForumThreadType,
	deleteForumThreadType,
	diffConfig,
	type ForumThreadTypesConfig,
	fetchForumThreadTypes,
	reorderForumThreadTypes,
	updateForumThreadType,
	updateForumThreadTypesConfig,
	validateConfig,
} from "@/viewmodels/admin/forum-thread-types";

const baseCfg: ForumThreadTypesConfig = {
	enabled: false,
	required: false,
	listable: false,
	prefix: false,
};

describe("forum-thread-types viewmodel — pure helpers", () => {
	describe("configFlagLabel", () => {
		it("maps every flag key to its Chinese label", () => {
			expect(configFlagLabel("enabled")).toBe("启用主题分类");
			expect(configFlagLabel("required")).toBe("发帖必选");
			expect(configFlagLabel("listable")).toBe("列表筛选");
			expect(configFlagLabel("prefix")).toBe("标题前缀");
		});
	});

	describe("diffConfig", () => {
		it("emits an empty patch when nothing changed", () => {
			expect(diffConfig(baseCfg, baseCfg)).toEqual({});
		});

		it("only includes flipped flags", () => {
			const next = { ...baseCfg, enabled: true, prefix: true };
			expect(diffConfig(baseCfg, next)).toEqual({ enabled: true, prefix: true });
		});

		it("emits explicit false when flipping a flag off", () => {
			const before = { ...baseCfg, enabled: true, listable: true };
			const next = { ...baseCfg, enabled: true, listable: false };
			expect(diffConfig(before, next)).toEqual({ listable: false });
		});
	});

	describe("validateConfig — required ⇒ enabled invariant", () => {
		it("allows required=false regardless of enabled", () => {
			expect(validateConfig(baseCfg)).toBeNull();
			expect(validateConfig({ ...baseCfg, enabled: true })).toBeNull();
		});

		it("allows required=true only when enabled=true", () => {
			expect(validateConfig({ ...baseCfg, enabled: true, required: true })).toBeNull();
		});

		it("rejects required=true with enabled=false", () => {
			expect(validateConfig({ ...baseCfg, required: true })).toContain("必须先启用");
		});
	});
});

describe("forum-thread-types viewmodel — API wrappers", () => {
	const meta = { timestamp: 1, requestId: "r1" };

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetchForumThreadTypes calls GET and unwraps data", async () => {
		const payload = { items: [], config: baseCfg };
		const spy = vi.spyOn(apiClient, "get").mockResolvedValue({ data: payload, meta });
		await expect(fetchForumThreadTypes(12)).resolves.toEqual(payload);
		expect(spy).toHaveBeenCalledWith("/api/admin/forums/12/thread-types");
	});

	it("createForumThreadType calls POST and unwraps data", async () => {
		const body = { name: "讨论" };
		const created = { id: 1, forumId: 12, name: "讨论", sortOrder: 1 };
		const spy = vi.spyOn(apiClient, "post").mockResolvedValue({ data: created, meta });
		await expect(createForumThreadType(12, body)).resolves.toEqual(created);
		expect(spy).toHaveBeenCalledWith("/api/admin/forums/12/thread-types", body);
	});

	it("updateForumThreadType calls PATCH and unwraps data", async () => {
		const body = { name: "公告" };
		const updated = { id: 3, forumId: 12, name: "公告", sortOrder: 1 };
		const spy = vi.spyOn(apiClient, "patch").mockResolvedValue({ data: updated, meta });
		await expect(updateForumThreadType(3, body)).resolves.toEqual(updated);
		expect(spy).toHaveBeenCalledWith("/api/admin/forum-thread-types/3", body);
	});

	it("deleteForumThreadType calls DELETE and unwraps data", async () => {
		const deleted = { deleted: true, id: 3 };
		const spy = vi.spyOn(apiClient, "delete").mockResolvedValue({ data: deleted, meta });
		await expect(deleteForumThreadType(3)).resolves.toEqual(deleted);
		expect(spy).toHaveBeenCalledWith("/api/admin/forum-thread-types/3");
	});

	it("reorderForumThreadTypes calls PATCH reorder endpoint", async () => {
		const result = { ok: true };
		const spy = vi.spyOn(apiClient, "patch").mockResolvedValue({ data: result, meta });
		await expect(reorderForumThreadTypes(12, [2, 1])).resolves.toEqual(result);
		expect(spy).toHaveBeenCalledWith("/api/admin/forums/12/thread-types/reorder", {
			ids: [2, 1],
		});
	});

	it("updateForumThreadTypesConfig calls PATCH config endpoint", async () => {
		const patch = { enabled: true };
		const result = { forumId: 12, config: { ...baseCfg, enabled: true } };
		const spy = vi.spyOn(apiClient, "patch").mockResolvedValue({ data: result, meta });
		await expect(updateForumThreadTypesConfig(12, patch)).resolves.toEqual(result);
		expect(spy).toHaveBeenCalledWith("/api/admin/forums/12/thread-types-config", patch);
	});
});
