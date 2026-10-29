import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { themeInitScript } from "@/lib/theme-init";

function browserContext(root: { classList: { toggle: ReturnType<typeof vi.fn> } }) {
	const colors = [new Map<string, string>(), new Map<string, string>()];
	const status = new Map<string, string>();
	const isDark = () => root.classList.toggle.mock.lastCall?.[1] === true;
	Object.assign(root.classList, { contains: isDark });
	return {
		colors,
		status,
		document: {
			documentElement: root,
			querySelectorAll: () => colors.map((meta) => ({ setAttribute: meta.set.bind(meta) })),
			querySelector: () => ({ setAttribute: status.set.bind(status) }),
		},
		getComputedStyle: () => ({ getPropertyValue: () => (isDark() ? "218 21% 12%" : "0 0% 100%") }),
	};
}

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
		const browser = browserContext(root);
		runInNewContext(themeInitScript, {
			...browser,
			localStorage: { getItem: (key: string) => (key === "theme" ? theme : "full") },
			matchMedia: () => ({ matches: systemDark }),
		});
		expect(root.classList.toggle).toHaveBeenCalledWith("dark", expectedDark);
		expect(root.style).toEqual({ colorScheme: expectedDark ? "dark" : "light" });
		expect(root.dataset).toEqual({ widthMode: "full" });
		for (const color of browser.colors) {
			expect(color.get("content")).toBe(expectedDark ? "hsl(218 21% 12%)" : "hsl(0 0% 100%)");
		}
		expect(browser.status.get("content")).toBe(expectedDark ? "black-translucent" : "default");
	});

	it("uses the system theme when storage is unavailable", () => {
		const root = { classList: { toggle: vi.fn() }, style: {}, dataset: {} };
		runInNewContext(themeInitScript, {
			...browserContext(root),
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
			...browserContext(root),
			localStorage: { getItem: () => null },
			matchMedia: () => ({ matches: false }),
		});
		expect(root.dataset).toEqual({});
	});

	it("keeps viewport fallback colors aligned with the header surface tokens", () => {
		const css = readFileSync(new URL("../../src/app/tailwind.css", import.meta.url), "utf8");
		const layout = readFileSync(new URL("../../src/app/layout.tsx", import.meta.url), "utf8");
		for (const token of ["0 0% 100%", "218 21% 12%"]) {
			expect(css).toContain(`--card: ${token};`);
			expect(layout).toContain(`color: "hsl(${token})"`);
		}
		expect(layout).toContain('viewportFit: "cover"');
	});
});
