import { describe, expect, it } from "vitest";

import { buildSelectOptions, resolveSelectPlaceholder } from "@/components/admin/admin-filters";

// ---------------------------------------------------------------------------
// AdminFilters — pure helpers
//
// We test the placeholder resolution and option list construction used by the
// select-filter rendering. The empty-value option is the user-visible "clear
// selection" entry; ensure its label never collapses into one of the option
// values (which would imply a selection has been made when nothing is set).
// ---------------------------------------------------------------------------

describe("resolveSelectPlaceholder", () => {
	it("falls back to `全部${label}` when no placeholder is provided", () => {
		expect(resolveSelectPlaceholder({ label: "状态" })).toBe("全部状态");
		expect(resolveSelectPlaceholder({ label: "锁定状态" })).toBe("全部锁定状态");
	});

	it("uses an explicit placeholder when provided", () => {
		expect(resolveSelectPlaceholder({ label: "状态", placeholder: "全部状态（含归档）" })).toBe(
			"全部状态（含归档）",
		);
	});

	it("never returns one of the would-be option labels by default", () => {
		// Regression for the threads page bug: label was "已锁定", so the empty
		// state showed "已锁定" and looked like the user had selected it.
		expect(resolveSelectPlaceholder({ label: "锁定状态" })).not.toBe("已锁定");
	});
});

describe("buildSelectOptions", () => {
	it("prepends the empty-value option for clearing the filter", () => {
		const options = buildSelectOptions({
			label: "状态",
			options: [
				{ value: "1", label: "正常" },
				{ value: "-1", label: "已封禁" },
			],
		});
		expect(options).toEqual([
			{ value: "", label: "全部状态" },
			{ value: "1", label: "正常" },
			{ value: "-1", label: "已封禁" },
		]);
	});

	it("uses the provided placeholder for the empty option", () => {
		const options = buildSelectOptions({
			label: "状态",
			placeholder: "任意状态",
			options: [{ value: "1", label: "正常" }],
		});
		expect(options[0]).toEqual({ value: "", label: "任意状态" });
	});

	it("treats missing options as an empty list (still emits empty option)", () => {
		expect(buildSelectOptions({ label: "类型" })).toEqual([{ value: "", label: "全部类型" }]);
	});

	it("keeps the empty option's value as empty string so it serves as the clear-filter entry", () => {
		const [first] = buildSelectOptions({
			label: "状态",
			options: [{ value: "1", label: "正常" }],
		});
		expect(first.value).toBe("");
	});
});
