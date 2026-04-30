import { describe, expect, it } from "vitest";
import {
	type SettingsMap,
	getArr,
	getBool,
	getNum,
	getStr,
} from "../../../../apps/web/src/viewmodels/forum/settings.server";

// ---------------------------------------------------------------------------
// getStr
// ---------------------------------------------------------------------------

describe("getStr", () => {
	const settings: SettingsMap = {
		name: "Ellie",
		count: 42,
		flag: true,
		obj: { key: "val" },
	};

	it("returns string value when present", () => {
		expect(getStr(settings, "name", "default")).toBe("Ellie");
	});

	it("returns stringified number when key maps to number", () => {
		expect(getStr(settings, "count", "default")).toBe("42");
	});

	it("returns stringified boolean when key maps to boolean", () => {
		expect(getStr(settings, "flag", "default")).toBe("true");
	});

	it("returns stringified object when key maps to object", () => {
		expect(getStr(settings, "obj", "default")).toBe("[object Object]");
	});

	it("returns fallback when key is missing", () => {
		expect(getStr(settings, "missing", "fallback")).toBe("fallback");
	});

	it("returns fallback for undefined value", () => {
		const s: SettingsMap = { key: undefined as unknown as string };
		expect(getStr(s, "key", "fallback")).toBe("fallback");
	});

	it("returns fallback for null value", () => {
		const s: SettingsMap = { key: null as unknown as string };
		expect(getStr(s, "key", "fallback")).toBe("fallback");
	});

	it("returns empty string value directly", () => {
		const s: SettingsMap = { name: "" };
		expect(getStr(s, "name", "fallback")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// getNum
// ---------------------------------------------------------------------------

describe("getNum", () => {
	it("returns number value when present", () => {
		const settings: SettingsMap = { count: 42 };
		expect(getNum(settings, "count", 0)).toBe(42);
	});

	it("returns parsed number from string", () => {
		const settings: SettingsMap = { count: "123" };
		expect(getNum(settings, "count", 0)).toBe(123);
	});

	it("returns fallback for NaN string", () => {
		const settings: SettingsMap = { count: "abc" };
		expect(getNum(settings, "count", 99)).toBe(99);
	});

	it("returns fallback for missing key", () => {
		const settings: SettingsMap = {};
		expect(getNum(settings, "missing", 10)).toBe(10);
	});

	it("returns fallback for boolean value", () => {
		const settings: SettingsMap = { count: true };
		expect(getNum(settings, "count", 10)).toBe(10);
	});

	it("returns fallback for object value", () => {
		const settings: SettingsMap = { count: { key: "val" } };
		expect(getNum(settings, "count", 10)).toBe(10);
	});

	it("parses float string", () => {
		const settings: SettingsMap = { count: "3.14" };
		expect(getNum(settings, "count", 0)).toBeCloseTo(3.14);
	});

	it("parses negative number string", () => {
		const settings: SettingsMap = { count: "-5" };
		expect(getNum(settings, "count", 0)).toBe(-5);
	});

	it("returns zero value directly", () => {
		const settings: SettingsMap = { count: 0 };
		expect(getNum(settings, "count", 99)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// getBool
// ---------------------------------------------------------------------------

describe("getBool", () => {
	it("returns boolean value when present (true)", () => {
		const settings: SettingsMap = { flag: true };
		expect(getBool(settings, "flag", false)).toBe(true);
	});

	it("returns boolean value when present (false)", () => {
		const settings: SettingsMap = { flag: false };
		expect(getBool(settings, "flag", true)).toBe(false);
	});

	it('returns true for string "true"', () => {
		const settings: SettingsMap = { flag: "true" };
		expect(getBool(settings, "flag", false)).toBe(true);
	});

	it('returns false for string "false"', () => {
		const settings: SettingsMap = { flag: "false" };
		expect(getBool(settings, "flag", true)).toBe(false);
	});

	it("returns fallback for other strings", () => {
		const settings: SettingsMap = { flag: "yes" };
		expect(getBool(settings, "flag", false)).toBe(false);
	});

	it("returns fallback for missing key", () => {
		const settings: SettingsMap = {};
		expect(getBool(settings, "missing", true)).toBe(true);
	});

	it("returns fallback for number value", () => {
		const settings: SettingsMap = { flag: 1 };
		expect(getBool(settings, "flag", false)).toBe(false);
	});

	it("returns fallback for object value", () => {
		const settings: SettingsMap = { flag: { key: "val" } };
		expect(getBool(settings, "flag", false)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getArr
// ---------------------------------------------------------------------------

describe("getArr", () => {
	it("returns array value when present", () => {
		const settings: SettingsMap = { items: [1, 2, 3] };
		expect(getArr(settings, "items", [])).toEqual([1, 2, 3]);
	});

	it("returns string array value", () => {
		const settings: SettingsMap = { items: ["a", "b"] };
		expect(getArr(settings, "items", [])).toEqual(["a", "b"]);
	});

	it("returns fallback for missing key", () => {
		const settings: SettingsMap = {};
		const fallback = [99];
		expect(getArr(settings, "missing", fallback)).toBe(fallback);
	});

	it("returns fallback for non-array value", () => {
		const settings: SettingsMap = { items: "not an array" };
		expect(getArr(settings, "items", [])).toEqual([]);
	});

	it("returns fallback for object value", () => {
		const settings: SettingsMap = { items: { key: "val" } };
		expect(getArr(settings, "items", [])).toEqual([]);
	});

	it("returns empty array value directly", () => {
		const settings: SettingsMap = { items: [] };
		expect(getArr(settings, "items", [1, 2])).toEqual([]);
	});

	it("preserves array element types", () => {
		const settings: SettingsMap = { items: [{ label: "a", url: "/a" }] };
		expect(getArr<{ label: string; url: string }>(settings, "items", [])).toEqual([
			{ label: "a", url: "/a" },
		]);
	});
});
