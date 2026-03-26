import { describe, expect, test } from "bun:test";
import { cn } from "@/lib/utils";

describe("cn", () => {
	test("merges class names", () => {
		expect(cn("foo", "bar")).toBe("foo bar");
	});

	test("handles conditional classes", () => {
		expect(cn("base", false && "hidden", "extra")).toBe("base extra");
	});

	test("merges tailwind conflicting classes (last wins)", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
	});

	test("handles empty input", () => {
		expect(cn()).toBe("");
	});

	test("handles undefined and null", () => {
		expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
	});
});
