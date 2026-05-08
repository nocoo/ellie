import { describe, expect, test } from "vitest";
import {
	hasCjkChars,
	hasEncodingIssue,
	tryRepairGbk,
	validateEncoding,
} from "../src/transform/encoding";

describe("hasCjkChars", () => {
	test("detects Chinese characters", () => {
		expect(hasCjkChars("你好世界")).toBe(true);
	});

	test("returns false for ASCII only", () => {
		expect(hasCjkChars("hello world")).toBe(false);
	});

	test("returns false for empty string", () => {
		expect(hasCjkChars("")).toBe(false);
	});

	test("detects mixed CJK and ASCII", () => {
		expect(hasCjkChars("hello 世界")).toBe(true);
	});
});

describe("hasEncodingIssue", () => {
	test("valid UTF-8 Chinese text has no issue", () => {
		expect(hasEncodingIssue("这是正常的中文文本")).toBe(false);
	});

	test("ASCII text has no issue", () => {
		expect(hasEncodingIssue("hello world")).toBe(false);
	});

	test("empty string has no issue", () => {
		expect(hasEncodingIssue("")).toBe(false);
	});

	test("detects replacement character", () => {
		expect(hasEncodingIssue("abc\uFFFDdef")).toBe(true);
	});

	test("text with many Latin1 supplement chars detected as suspicious", () => {
		// Simulate GBK bytes misread as Latin1: lots of chars in 0x80-0xFF range
		const suspicious = String.fromCharCode(0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7);
		expect(hasEncodingIssue(suspicious)).toBe(true);
	});
});

describe("tryRepairGbk", () => {
	test("repairs GBK '你好' misread as Latin1", () => {
		// GBK encoding of "你好" is 0xC4E3 0xBAC3
		const mojibake = String.fromCharCode(0xc4, 0xe3, 0xba, 0xc3);
		const repaired = tryRepairGbk(mojibake);
		expect(repaired).toBe("你好");
	});

	test("returns null for non-repairable text", () => {
		// Text with characters above 0xFF can't be GBK mojibake
		expect(tryRepairGbk("正常中文")).toBeNull();
	});

	test("returns null for invalid GBK sequence", () => {
		// Random bytes that don't form valid GBK
		const invalid = String.fromCharCode(0xff, 0xfe, 0x01);
		expect(tryRepairGbk(invalid)).toBeNull();
	});

	test("returns null when GBK decode succeeds but yields no CJK (line 67 branch)", () => {
		// Pure ASCII bytes are valid GBK and decode to ASCII — hasCjkChars()
		// is false, exercising the explicit `return null` after the decoder
		// succeeds (encoding.ts:67), not the catch fallback.
		const asciiOnly = String.fromCharCode(0x41, 0x42, 0x43);
		expect(tryRepairGbk(asciiOnly)).toBeNull();
	});
});

describe("validateEncoding", () => {
	test("valid text passes through unchanged", () => {
		const result = validateEncoding("正常中文文本");
		expect(result.text).toBe("正常中文文本");
		expect(result.repaired).toBe(false);
	});

	test("empty string passes through", () => {
		const result = validateEncoding("");
		expect(result.text).toBe("");
		expect(result.repaired).toBe(false);
	});

	test("ASCII text passes through", () => {
		const result = validateEncoding("hello world");
		expect(result.text).toBe("hello world");
		expect(result.repaired).toBe(false);
	});

	test("GBK mojibake gets repaired", () => {
		const mojibake = String.fromCharCode(0xc4, 0xe3, 0xba, 0xc3);
		const result = validateEncoding(mojibake);
		expect(result.text).toBe("你好");
		expect(result.repaired).toBe(true);
	});

	test("unrepairable text returned as-is", () => {
		// Text with replacement character but not repairable
		const broken = "abc\uFFFDdef";
		const result = validateEncoding(broken);
		expect(result.text).toBe(broken);
		expect(result.repaired).toBe(false);
	});
});
