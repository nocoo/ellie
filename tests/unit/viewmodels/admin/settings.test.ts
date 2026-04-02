import { describe, expect, it } from "bun:test";
import {
	SETTING_GROUPS,
	type SettingsDetailMap,
	getChangedSettings,
	toFormValues,
} from "../../../../apps/web/src/viewmodels/admin/settings";

// ---------------------------------------------------------------------------
// SETTING_GROUPS structure tests
// ---------------------------------------------------------------------------

describe("SETTING_GROUPS", () => {
	it("should have exactly 4 groups", () => {
		expect(SETTING_GROUPS).toHaveLength(4);
	});

	it("should define 16 total fields across all groups", () => {
		const totalFields = SETTING_GROUPS.reduce((sum, g) => sum + g.fields.length, 0);
		expect(totalFields).toBe(16);
	});

	it("should have correct group titles", () => {
		const titles = SETTING_GROUPS.map((g) => g.title);
		expect(titles).toEqual(["站点品牌", "OG 社交媒体元数据", "分页与限制", "资源配置"]);
	});

	it("should have correct group prefixes", () => {
		const prefixes = SETTING_GROUPS.map((g) => g.prefix);
		expect(prefixes).toEqual([
			"general.site",
			"general.og",
			"general.pagination",
			"general.assets",
		]);
	});

	it("all fields should have keys matching their group prefix", () => {
		for (const group of SETTING_GROUPS) {
			for (const field of group.fields) {
				expect(field.key.startsWith(group.prefix)).toBe(true);
			}
		}
	});

	it("all pagination fields should have inputType 'number'", () => {
		const paginationGroup = SETTING_GROUPS.find((g) => g.prefix === "general.pagination");
		expect(paginationGroup).toBeDefined();
		for (const field of paginationGroup?.fields ?? []) {
			expect(field.inputType).toBe("number");
		}
	});

	it("URL fields should have inputType 'url'", () => {
		const urlFields = SETTING_GROUPS.flatMap((g) => g.fields).filter((f) => f.inputType === "url");
		expect(urlFields.length).toBeGreaterThan(0);
		for (const field of urlFields) {
			expect(field.key).toMatch(/\.(image|url|avatar_cdn_base)$/);
		}
	});

	it("should have unique keys across all groups", () => {
		const allKeys = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
		const uniqueKeys = new Set(allKeys);
		expect(allKeys.length).toBe(uniqueKeys.size);
	});
});

// ---------------------------------------------------------------------------
// toFormValues
// ---------------------------------------------------------------------------

describe("toFormValues", () => {
	it("should convert SettingsDetailMap to flat string map", () => {
		const settings: SettingsDetailMap = {
			"general.site.name": { value: "Ellie", type: "string", updatedAt: 1700000000 },
			"general.pagination.posts_per_page": { value: "20", type: "number", updatedAt: 1700000000 },
		};

		const result = toFormValues(settings);

		expect(result).toEqual({
			"general.site.name": "Ellie",
			"general.pagination.posts_per_page": "20",
		});
	});

	it("should handle empty settings", () => {
		expect(toFormValues({})).toEqual({});
	});

	it("should preserve empty string values", () => {
		const settings: SettingsDetailMap = {
			"general.og.title": { value: "", type: "string", updatedAt: 1700000000 },
		};

		const result = toFormValues(settings);

		expect(result["general.og.title"]).toBe("");
	});
});

// ---------------------------------------------------------------------------
// getChangedSettings
// ---------------------------------------------------------------------------

describe("getChangedSettings", () => {
	it("should return only changed values", () => {
		const current = { a: "new", b: "same", c: "changed" };
		const saved = { a: "old", b: "same", c: "original" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ a: "new", c: "changed" });
	});

	it("should return empty object when nothing changed", () => {
		const values = { a: "1", b: "2" };

		expect(getChangedSettings(values, values)).toEqual({});
	});

	it("should detect empty string as change from non-empty", () => {
		const current = { "general.site.name": "" };
		const saved = { "general.site.name": "Ellie" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ "general.site.name": "" });
	});

	it("should handle new keys in current (not in saved)", () => {
		const current = { a: "1", b: "new" };
		const saved = { a: "1" };

		const result = getChangedSettings(current, saved);

		expect(result).toEqual({ b: "new" });
	});
});
