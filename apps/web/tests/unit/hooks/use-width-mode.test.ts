import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub window/localStorage/document BEFORE module import
const mockLocalStorage = (() => {
	const store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
	};
})();

vi.stubGlobal("window", { localStorage: mockLocalStorage });
vi.stubGlobal("localStorage", mockLocalStorage);
vi.stubGlobal("document", {
	documentElement: { dataset: {} as Record<string, string | undefined> },
});

vi.mock("react", () => ({
	useSyncExternalStore: (_sub: any, getSnap: any, _server: any) => getSnap(),
	useCallback: (fn: any) => fn,
	useEffect: (fn: () => void) => {
		fn();
	},
}));

import { useWidthMode, widthModeInitScript } from "@/hooks/use-width-mode";

describe("use-width-mode", () => {
	beforeEach(() => {
		mockLocalStorage.clear();
		(document as any).documentElement.dataset = {};
	});

	it("defaults to centered mode", () => {
		const { mode } = useWidthMode();
		expect(mode).toBe("centered");
	});

	it("reads full mode from localStorage", () => {
		mockLocalStorage.setItem("width-mode", "full");
		const { mode } = useWidthMode();
		expect(mode).toBe("full");
	});

	it("setMode full writes to localStorage and DOM", () => {
		const { setMode } = useWidthMode();
		setMode("full");
		expect(mockLocalStorage.getItem("width-mode")).toBe("full");
		expect((document as any).documentElement.dataset.widthMode).toBe("full");
	});

	it("setMode centered removes from localStorage and DOM", () => {
		mockLocalStorage.setItem("width-mode", "full");
		(document as any).documentElement.dataset.widthMode = "full";
		const { setMode } = useWidthMode();
		setMode("centered");
		expect(mockLocalStorage.getItem("width-mode")).toBe(null);
		expect((document as any).documentElement.dataset.widthMode).toBeUndefined();
	});

	it("toggleMode switches from centered to full", () => {
		const { toggleMode } = useWidthMode();
		toggleMode();
		expect(mockLocalStorage.getItem("width-mode")).toBe("full");
	});

	it("toggleMode switches from full to centered", () => {
		mockLocalStorage.setItem("width-mode", "full");
		const { toggleMode } = useWidthMode();
		toggleMode();
		expect(mockLocalStorage.getItem("width-mode")).toBe(null);
	});

	it("exports widthModeInitScript as a string", () => {
		expect(typeof widthModeInitScript).toBe("string");
		expect(widthModeInitScript).toContain("width-mode");
	});
});
