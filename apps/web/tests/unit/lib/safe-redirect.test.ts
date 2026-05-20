import { safeRedirect } from "@/lib/safe-redirect";
import { describe, expect, test } from "vitest";

describe("safeRedirect", () => {
	test("returns fallback for null/undefined/empty", () => {
		expect(safeRedirect(null)).toBe("/");
		expect(safeRedirect(undefined)).toBe("/");
		expect(safeRedirect("")).toBe("/");
	});

	test("returns fallback when not starting with /", () => {
		expect(safeRedirect("https://evil.example")).toBe("/");
		expect(safeRedirect("http://evil.example/login")).toBe("/");
		expect(safeRedirect("evil.example")).toBe("/");
		expect(safeRedirect("javascript:alert(1)")).toBe("/");
		expect(safeRedirect("./relative")).toBe("/");
	});

	test("rejects protocol-relative URLs", () => {
		expect(safeRedirect("//evil.example")).toBe("/");
		expect(safeRedirect("//evil.example/login")).toBe("/");
	});

	test("rejects backslash-prefixed paths (browser normalizes to //)", () => {
		expect(safeRedirect("/\\evil.example")).toBe("/");
	});

	test("rejects paths containing control characters", () => {
		expect(safeRedirect("/foo\nbar")).toBe("/");
		expect(safeRedirect("/foo\rbar")).toBe("/");
		expect(safeRedirect("/foo\x00bar")).toBe("/");
		expect(safeRedirect("/foo\x7fbar")).toBe("/");
	});

	test("accepts same-origin absolute paths", () => {
		expect(safeRedirect("/")).toBe("/");
		expect(safeRedirect("/forum")).toBe("/forum");
		expect(safeRedirect("/forum/123")).toBe("/forum/123");
		expect(safeRedirect("/forum/123?page=2")).toBe("/forum/123?page=2");
		expect(safeRedirect("/forum/123#anchor")).toBe("/forum/123#anchor");
	});

	test("honors custom fallback", () => {
		expect(safeRedirect(null, "/home")).toBe("/home");
		expect(safeRedirect("https://evil.example", "/home")).toBe("/home");
		expect(safeRedirect("//evil.example", "/home")).toBe("/home");
	});

	test("rejects non-string input", () => {
		expect(safeRedirect(123 as unknown as string)).toBe("/");
		expect(safeRedirect({} as unknown as string)).toBe("/");
	});
});
