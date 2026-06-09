import { describe, expect, it } from "vitest";
import { getChangedSettings, SETTING_GROUPS, toFormValues } from "@/viewmodels/admin/settings";

describe("settings", () => {
	describe("SETTING_GROUPS", () => {
		it("is non-empty array", () => {
			expect(SETTING_GROUPS.length).toBeGreaterThan(0);
		});

		it("each group has title, prefix, and fields", () => {
			for (const group of SETTING_GROUPS) {
				expect(group.title).toBeTruthy();
				expect(group.prefix).toBeTruthy();
				expect(group.fields.length).toBeGreaterThan(0);
			}
		});

		it("站点品牌 group contains brand configuration fields", () => {
			const brandGroup = SETTING_GROUPS.find((g) => g.prefix === "general.site");
			expect(brandGroup).toBeDefined();
			const keys = brandGroup?.fields.map((f) => f.key);
			expect(keys).toContain("general.site.home_label");
			expect(keys).toContain("general.site.logo_light");
			expect(keys).toContain("general.site.logo_dark");
			expect(keys).toContain("general.site.footer_bg_light");
			expect(keys).toContain("general.site.footer_bg_dark");
			expect(keys).toContain("general.site.copyright_years");
		});

		it("logo and background fields use url inputType", () => {
			const brandGroup = SETTING_GROUPS.find((g) => g.prefix === "general.site");
			expect(brandGroup).toBeDefined();
			const urlKeys = [
				"general.site.logo_light",
				"general.site.logo_dark",
				"general.site.footer_bg_light",
				"general.site.footer_bg_dark",
			];
			for (const key of urlKeys) {
				const field = brandGroup?.fields.find((f) => f.key === key);
				expect(field?.inputType).toBe("url");
			}
		});
	});

	describe("toFormValues", () => {
		it("converts SettingsDetailMap to flat strings", () => {
			const settings = {
				"general.site.name": { value: "Ellie", type: "string" as const, updatedAt: 1 },
				"general.site.subtitle": { value: "Forum", type: "string" as const, updatedAt: 2 },
			};
			const result = toFormValues(settings);
			expect(result["general.site.name"]).toBe("Ellie");
			expect(result["general.site.subtitle"]).toBe("Forum");
		});

		it("returns empty object for empty map", () => {
			expect(toFormValues({})).toEqual({});
		});
	});

	describe("getChangedSettings", () => {
		it("returns only changed keys", () => {
			const current = { a: "new", b: "same" };
			const saved = { a: "old", b: "same" };
			expect(getChangedSettings(current, saved)).toEqual({ a: "new" });
		});

		it("returns empty object when no changes", () => {
			const values = { a: "x", b: "y" };
			expect(getChangedSettings(values, values)).toEqual({});
		});

		it("includes keys not in saved", () => {
			const current = { a: "val" };
			const saved = {};
			expect(getChangedSettings(current, saved)).toEqual({ a: "val" });
		});
	});
});
