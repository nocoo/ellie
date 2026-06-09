import { describe, expect, it } from "vitest";
import {
	configFlagLabel,
	diffConfig,
	type ForumThreadTypesConfig,
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
