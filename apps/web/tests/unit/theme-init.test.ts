import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { themeInitScript } from "@/lib/theme-init";

describe("first-paint appearance", () => {
	it.each([
		["dark", false, true],
		["light", true, false],
		[null, true, true],
		[null, false, false],
		["system", true, true],
		["invalid", false, false],
	])("resolves stored %s with system dark=%s", (theme, systemDark, expectedDark) => {
		const root = { classList: { toggle: vi.fn() }, style: {}, dataset: {} };
		runInNewContext(themeInitScript, {
			document: { documentElement: root },
			localStorage: { getItem: (key: string) => (key === "theme" ? theme : "full") },
			matchMedia: () => ({ matches: systemDark }),
		});
		expect(root.classList.toggle).toHaveBeenCalledWith("dark", expectedDark);
		expect(root.style).toEqual({ colorScheme: expectedDark ? "dark" : "light" });
		expect(root.dataset).toEqual({ widthMode: "full" });
	});

	it("uses the system theme when storage is unavailable", () => {
		const root = { classList: { toggle: vi.fn() }, style: {}, dataset: {} };
		runInNewContext(themeInitScript, {
			document: { documentElement: root },
			localStorage: {
				getItem() {
					throw new Error("Storage is unavailable");
				},
			},
			matchMedia: () => ({ matches: true }),
		});
		expect(root.classList.toggle).toHaveBeenCalledWith("dark", true);
		expect(root.style).toEqual({ colorScheme: "dark" });
		expect(root.dataset).toEqual({});
	});

	it("preserves the default width without a saved preference", () => {
		const root = { classList: { toggle: vi.fn() }, style: {}, dataset: {} };
		runInNewContext(themeInitScript, {
			document: { documentElement: root },
			localStorage: { getItem: () => null },
			matchMedia: () => ({ matches: false }),
		});
		expect(root.dataset).toEqual({});
	});
});
