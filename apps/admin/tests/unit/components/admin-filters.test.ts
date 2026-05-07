import { describe, expect, it } from "vitest";

import {
	buildSelectOptions,
	dateInputToUnixSecondsEnd,
	dateInputToUnixSecondsStart,
	normalizeNumRangeBound,
	rangeMaxKey,
	rangeMinKey,
	resolveSelectPlaceholder,
} from "@/components/admin/admin-filters";

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

// ---------------------------------------------------------------------------
// Range key helpers
// ---------------------------------------------------------------------------

describe("rangeMinKey / rangeMaxKey", () => {
	// Centralised so AdminFilters component, viewmodels, and worker
	// query-param naming all agree. Worker `range` filter type defaults
	// to the same `${param}Min` / `${param}Max` naming.
	it("appends Min / Max suffix to the filter key", () => {
		expect(rangeMinKey("regDate")).toBe("regDateMin");
		expect(rangeMaxKey("regDate")).toBe("regDateMax");
		expect(rangeMinKey("threads")).toBe("threadsMin");
		expect(rangeMaxKey("credits")).toBe("creditsMax");
	});
});

// ---------------------------------------------------------------------------
// normalizeNumRangeBound — input validation for numrange filter
// ---------------------------------------------------------------------------

describe("normalizeNumRangeBound", () => {
	it("returns null for empty / whitespace input", () => {
		expect(normalizeNumRangeBound("")).toBeNull();
		expect(normalizeNumRangeBound("   ")).toBeNull();
	});

	it("returns null for non-numeric input", () => {
		expect(normalizeNumRangeBound("abc")).toBeNull();
		expect(normalizeNumRangeBound("1.2.3")).toBeNull();
	});

	it("returns the numeric string for valid numbers", () => {
		expect(normalizeNumRangeBound("42")).toBe("42");
		expect(normalizeNumRangeBound("  10 ")).toBe("10");
		expect(normalizeNumRangeBound("3.14")).toBe("3.14");
		expect(normalizeNumRangeBound("-5")).toBe("-5");
	});

	it("treats `0` as a valid bound (not falsy-dropped)", () => {
		// Mirrors worker `range` filter `Number.isFinite` guard — `0` must
		// survive so legit zero ranges (e.g. posts >= 0) work.
		expect(normalizeNumRangeBound("0")).toBe("0");
	});

	it("returns null for Infinity / NaN", () => {
		expect(normalizeNumRangeBound("Infinity")).toBeNull();
		expect(normalizeNumRangeBound("NaN")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// dateInputToUnixSeconds{Start,End} — daterange filter UI conversion
//
// Daterange UI emits HTML date input strings (`YYYY-MM-DD`, local-day
// semantics). We must convert to unix seconds with inclusive bounds:
// Start → 00:00:00 of that local day; End → 23:59:59 of that local day.
// Inclusive matches worker `range` filter (`>=` / `<=`).
//
// We assert via round-trip Date construction in the test's local TZ so the
// suite is timezone-independent (CI may run in UTC, devs may run in PST).
// ---------------------------------------------------------------------------

describe("dateInputToUnixSecondsStart", () => {
	it("returns the unix-seconds for 00:00:00 local time on the given day", () => {
		const result = dateInputToUnixSecondsStart("2026-05-07");
		expect(result).not.toBeNull();
		const expected = Math.floor(new Date(2026, 4, 7, 0, 0, 0).getTime() / 1000);
		expect(result).toBe(expected);
	});

	it("returns null for empty / malformed input", () => {
		expect(dateInputToUnixSecondsStart("")).toBeNull();
		expect(dateInputToUnixSecondsStart("not-a-date")).toBeNull();
		expect(dateInputToUnixSecondsStart("2026/05/07")).toBeNull();
	});

	it("returns null for impossible calendar dates (no rollover)", () => {
		// Native Date would roll Feb 30 to Mar 2; we reject instead so the
		// caller knows the input was bad.
		expect(dateInputToUnixSecondsStart("2026-02-30")).toBeNull();
		expect(dateInputToUnixSecondsStart("2026-13-01")).toBeNull();
		expect(dateInputToUnixSecondsStart("2026-00-15")).toBeNull();
	});
});

describe("dateInputToUnixSecondsEnd", () => {
	it("returns the unix-seconds for 23:59:59 local time on the given day (inclusive bound)", () => {
		const result = dateInputToUnixSecondsEnd("2026-05-07");
		expect(result).not.toBeNull();
		const expected = Math.floor(new Date(2026, 4, 7, 23, 59, 59).getTime() / 1000);
		expect(result).toBe(expected);
	});

	it("end is exactly start + 86399 seconds (one second short of next day)", () => {
		// Locks the inclusive convention: full local day = [00:00:00, 23:59:59].
		const start = dateInputToUnixSecondsStart("2026-05-07");
		const end = dateInputToUnixSecondsEnd("2026-05-07");
		expect(end).not.toBeNull();
		expect(start).not.toBeNull();
		expect((end as number) - (start as number)).toBe(86_399);
	});

	it("returns null for empty / malformed input", () => {
		expect(dateInputToUnixSecondsEnd("")).toBeNull();
		expect(dateInputToUnixSecondsEnd("oops")).toBeNull();
	});

	it("returns null for impossible calendar dates", () => {
		expect(dateInputToUnixSecondsEnd("2026-02-30")).toBeNull();
	});
});
