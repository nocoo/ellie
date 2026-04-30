import {
	actionLabel,
	buildCensorWordSearchParams,
	replacementDisplay,
} from "@/viewmodels/admin/censor-words";
import { describe, expect, it } from "vitest";

describe("censor-words", () => {
	describe("buildCensorWordSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildCensorWordSearchParams({ page: 1, limit: 20 });
			expect(params.page).toBe(1);
			expect(params.limit).toBe(20);
		});

		it("includes find when set", () => {
			const params = buildCensorWordSearchParams({ find: "bad" });
			expect(params.find).toBe("bad");
		});

		it("omits empty find", () => {
			const params = buildCensorWordSearchParams({ find: "" });
			expect(params.find).toBeUndefined();
		});

		it("includes action when set", () => {
			const params = buildCensorWordSearchParams({ action: "ban" });
			expect(params.action).toBe("ban");
		});

		it("omits empty action", () => {
			const params = buildCensorWordSearchParams({ action: "" });
			expect(params.action).toBeUndefined();
		});
	});

	describe("replacementDisplay", () => {
		it("returns *** for empty replacement", () => {
			expect(replacementDisplay("")).toBe("***");
		});

		it("returns replacement as-is when non-empty", () => {
			expect(replacementDisplay("*")).toBe("*");
			expect(replacementDisplay("censored")).toBe("censored");
		});
	});

	describe("actionLabel", () => {
		it("returns 禁止发布 for ban", () => {
			expect(actionLabel("ban")).toBe("禁止发布");
		});

		it("returns 替换 for replace", () => {
			expect(actionLabel("replace")).toBe("替换");
		});
	});
});
