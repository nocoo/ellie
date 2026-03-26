import { describe, expect, test } from "bun:test";
import { MOBILE_BREAKPOINT } from "@/hooks/use-is-mobile";

// useIsMobile and useDebounce are React hooks that require a DOM/React
// test environment for state transition testing (L2). L1 tests validate
// constants and module exports.

describe("useIsMobile", () => {
	test("exports MOBILE_BREAKPOINT as 768", () => {
		expect(MOBILE_BREAKPOINT).toBe(768);
	});

	test("exports useIsMobile function", async () => {
		const mod = await import("@/hooks/use-is-mobile");
		expect(typeof mod.useIsMobile).toBe("function");
	});
});

describe("useDebounce", () => {
	test("exports useDebounce function", async () => {
		const mod = await import("@/hooks/use-debounce");
		expect(typeof mod.useDebounce).toBe("function");
	});
});
