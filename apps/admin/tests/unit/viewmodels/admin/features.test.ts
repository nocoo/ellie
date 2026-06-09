import { describe, expect, it } from "vitest";
import {
	FEATURE_DEFAULTS,
	FEATURE_GROUPS,
	getAllFeatureKeys,
	getChangedSettings,
	toFormValues,
} from "@/viewmodels/admin/features";

describe("features", () => {
	describe("FEATURE_GROUPS", () => {
		it("is non-empty", () => {
			expect(FEATURE_GROUPS.length).toBeGreaterThan(0);
		});

		it("each group has id, title, prefix, and fields", () => {
			for (const group of FEATURE_GROUPS) {
				expect(group.id).toBeTruthy();
				expect(group.title).toBeTruthy();
				expect(group.prefix).toBeTruthy();
				expect(group.fields.length).toBeGreaterThan(0);
			}
		});
	});

	describe("FEATURE_DEFAULTS", () => {
		it("contains expected keys", () => {
			expect(FEATURE_DEFAULTS["features.access.require_login"]).toBe("false");
			expect(FEATURE_DEFAULTS["features.content.allow_new_thread"]).toBe("true");
		});
	});

	describe("toFormValues", () => {
		it("applies defaults for missing keys", () => {
			const result = toFormValues({});
			expect(result["features.access.require_login"]).toBe("false");
			expect(result["features.content.allow_new_thread"]).toBe("true");
		});

		it("overlays settings on top of defaults", () => {
			const settings = {
				"features.access.require_login": {
					value: "true",
					type: "boolean" as const,
					updatedAt: 1,
				},
			};
			const result = toFormValues(settings);
			expect(result["features.access.require_login"]).toBe("true");
			// Other defaults still present
			expect(result["features.content.allow_new_thread"]).toBe("true");
		});
	});

	describe("getChangedSettings", () => {
		it("returns only changed keys", () => {
			const current = { a: "new", b: "same" };
			const saved = { a: "old", b: "same" };
			expect(getChangedSettings(current, saved)).toEqual({ a: "new" });
		});

		it("returns empty when no changes", () => {
			const v = { a: "x" };
			expect(getChangedSettings(v, v)).toEqual({});
		});
	});

	describe("getAllFeatureKeys", () => {
		it("returns all keys from FEATURE_GROUPS", () => {
			const keys = getAllFeatureKeys();
			expect(keys).toContain("features.access.require_login");
			expect(keys).toContain("features.content.allow_new_thread");
			expect(keys).toContain("features.posting.enabled");
			expect(keys.length).toBeGreaterThan(5);
		});
	});
});
