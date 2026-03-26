import { describe, expect, test } from "bun:test";
import type { Theme } from "@/hooks/use-theme";
import { themeInitScript } from "@/hooks/use-theme";

// ─── useTheme hook tests ──────────────────────────────────
// The hook itself uses React hooks (useSyncExternalStore) and browser APIs
// (localStorage, matchMedia, document.documentElement), so full hook testing
// requires a DOM environment (L2/L3 level). Here we test the exported
// constants and the FOUC init script structure (L1).

describe("themeInitScript", () => {
	test("is a non-empty string", () => {
		expect(typeof themeInitScript).toBe("string");
		expect(themeInitScript.length).toBeGreaterThan(0);
	});

	test("references localStorage for persistence", () => {
		expect(themeInitScript).toContain("localStorage");
	});

	test("references prefers-color-scheme media query", () => {
		expect(themeInitScript).toContain("prefers-color-scheme");
	});

	test("adds .dark class conditionally", () => {
		expect(themeInitScript).toContain("classList.add");
		expect(themeInitScript).toContain("dark");
	});

	test("is a self-executing function (IIFE)", () => {
		expect(themeInitScript).toMatch(/^\(function/);
		expect(themeInitScript).toMatch(/\}\)\(\);$/);
	});

	test("handles errors gracefully with try-catch", () => {
		expect(themeInitScript).toContain("try");
		expect(themeInitScript).toContain("catch");
	});

	test("checks for 'light' explicitly (three-state)", () => {
		// Must distinguish light/dark/system — not just dark/not-dark
		expect(themeInitScript).toContain("light");
	});
});

describe("useTheme module exports", () => {
	test("exports useTheme function", async () => {
		const mod = await import("@/hooks/use-theme");
		expect(typeof mod.useTheme).toBe("function");
	});

	test("exports themeInitScript string", async () => {
		const mod = await import("@/hooks/use-theme");
		expect(typeof mod.themeInitScript).toBe("string");
	});

	test("exports Theme type (light/dark/system)", () => {
		// Type-level check: if this compiles, the type is exported correctly
		const themes: Theme[] = ["light", "dark", "system"];
		expect(themes).toHaveLength(3);
	});
});
