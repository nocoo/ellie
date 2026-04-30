import { SETTING_GROUPS, getChangedSettings, toFormValues } from "@/viewmodels/admin/settings";
import { describe, expect, it } from "vitest";

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
