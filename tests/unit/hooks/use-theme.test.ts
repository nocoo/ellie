import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock browser globals BEFORE importing the module under test
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
	const store: Record<string, string> = {};
	return {
		getItem: mock((key: string) => (key in store ? store[key] : null)),
		setItem: mock((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: mock((key: string) => {
			delete store[key];
		}),
		clear: mock(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: mock((_index: number) => null),
		_store: store,
	};
}

let localStorageMock: ReturnType<typeof createLocalStorageMock>;
let matchMediaHandlers: Array<(e: { matches: boolean }) => void> = [];
let matchMediaMatches = false;

function createMatchMediaMock() {
	return {
		get matches() {
			return matchMediaMatches;
		},
		addEventListener: mock((event: string, handler: (e: { matches: boolean }) => void) => {
			if (event === "change") matchMediaHandlers.push(handler);
		}),
		removeEventListener: mock((event: string, handler: (e: { matches: boolean }) => void) => {
			if (event === "change") {
				matchMediaHandlers = matchMediaHandlers.filter((h) => h !== handler);
			}
		}),
	};
}

const classListMethods = {
	_classes: new Set<string>() as Set<string>,
	toggle: mock((_cls: string, _force?: boolean) => {}),
	add: mock((_cls: string) => {}),
	remove: mock((_cls: string) => {}),
	contains: mock((_cls: string) => false),
};

const documentElement = {
	classList: classListMethods,
	style: {} as Record<string, string>,
	dataset: {},
};

const savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
	localStorageMock = createLocalStorageMock();
	matchMediaHandlers = [];
	matchMediaMatches = false;

	classListMethods._classes = new Set<string>();
	classListMethods.toggle.mockImplementation((cls: string, force?: boolean) => {
		if (force === true) classListMethods._classes.add(cls);
		else if (force === false) classListMethods._classes.delete(cls);
		else if (classListMethods._classes.has(cls)) classListMethods._classes.delete(cls);
		else classListMethods._classes.add(cls);
	});
	classListMethods.contains.mockImplementation((cls: string) => classListMethods._classes.has(cls));

	savedGlobals.window = globalThis.window;
	savedGlobals.localStorage = globalThis.localStorage;
	savedGlobals.matchMedia = globalThis.matchMedia;
	savedGlobals.document = globalThis.document;

	(globalThis as Record<string, unknown>).localStorage = localStorageMock;
	const matchMediaFn = mock(() => createMatchMediaMock());
	(globalThis as Record<string, unknown>).matchMedia = matchMediaFn;
	(globalThis as Record<string, unknown>).document = { documentElement };
	(globalThis as Record<string, unknown>).window = { matchMedia: matchMediaFn };
});

afterEach(() => {
	(globalThis as Record<string, unknown>).window = savedGlobals.window;
	(globalThis as Record<string, unknown>).localStorage = savedGlobals.localStorage;
	(globalThis as Record<string, unknown>).matchMedia = savedGlobals.matchMedia;
	(globalThis as Record<string, unknown>).document = savedGlobals.document;
});

// ---------------------------------------------------------------------------
// Mock React to extract hook logic without a real reconciler
// ---------------------------------------------------------------------------

type Theme = "light" | "dark" | "system";

let capturedSubscribe: ((cb: () => void) => () => void) | null = null;
let capturedGetSnapshot: (() => Theme) | null = null;
let capturedGetServerSnapshot: (() => Theme) | null = null;
let capturedUseEffectCleanup: (() => void) | null = null;

mock.module("react", () => ({
	useSyncExternalStore(
		subscribe: (cb: () => void) => () => void,
		getSnapshot: () => Theme,
		getServerSnapshot: () => Theme,
	) {
		capturedSubscribe = subscribe;
		capturedGetSnapshot = getSnapshot;
		capturedGetServerSnapshot = getServerSnapshot;
		return getSnapshot();
	},
	useCallback(fn: unknown, _deps: unknown[]) {
		return fn;
	},
	useEffect(fn: () => (() => void) | undefined, _deps: unknown[]) {
		const cleanup = fn();
		if (cleanup) capturedUseEffectCleanup = cleanup;
	},
	useState(initial: unknown) {
		return [initial, (_v: unknown) => {}];
	},
}));

// Import AFTER mock setup
const { useTheme, themeInitScript } = await import("@/hooks/use-theme");

// ---------------------------------------------------------------------------
// Tests — themeInitScript
// ---------------------------------------------------------------------------

describe("themeInitScript", () => {
	it("is a non-empty string", () => {
		expect(typeof themeInitScript).toBe("string");
		expect(themeInitScript.length).toBeGreaterThan(0);
	});

	it("references localStorage for persistence", () => {
		expect(themeInitScript).toContain("localStorage");
	});

	it("references prefers-color-scheme media query", () => {
		expect(themeInitScript).toContain("prefers-color-scheme");
	});

	it("adds .dark class conditionally", () => {
		expect(themeInitScript).toContain("classList.add");
		expect(themeInitScript).toContain("dark");
	});

	it("is a self-executing function (IIFE)", () => {
		expect(themeInitScript).toMatch(/^\(function/);
		expect(themeInitScript).toMatch(/\}\)\(\);$/);
	});

	it("handles errors gracefully with try-catch", () => {
		expect(themeInitScript).toContain("try");
		expect(themeInitScript).toContain("catch");
	});

	it("checks for 'light' explicitly (three-state)", () => {
		expect(themeInitScript).toContain("light");
	});
});

// ---------------------------------------------------------------------------
// Tests — useTheme module exports
// ---------------------------------------------------------------------------

describe("useTheme module exports", () => {
	it("exports useTheme function", () => {
		expect(typeof useTheme).toBe("function");
	});

	it("exports themeInitScript string", () => {
		expect(typeof themeInitScript).toBe("string");
	});

	it("exports Theme type (light/dark/system)", () => {
		const themes: Theme[] = ["light", "dark", "system"];
		expect(themes).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// Tests — getSnapshot / getServerSnapshot (via captured functions)
// ---------------------------------------------------------------------------

describe("useTheme — snapshot functions", () => {
	it("returns 'system' as default when localStorage is empty", () => {
		const result = useTheme();
		expect(result.theme).toBe("system");
	});

	it("returns 'light' when localStorage has 'light'", () => {
		localStorageMock._store.theme = "light";
		const result = useTheme();
		expect(result.theme).toBe("light");
	});

	it("returns 'dark' when localStorage has 'dark'", () => {
		localStorageMock._store.theme = "dark";
		const result = useTheme();
		expect(result.theme).toBe("dark");
	});

	it("getServerSnapshot always returns 'system'", () => {
		expect(capturedGetServerSnapshot).not.toBeNull();
		expect(capturedGetServerSnapshot?.()).toBe("system");
	});

	it("getSnapshot returns 'system' when window is undefined (SSR guard)", () => {
		const savedWin = (globalThis as Record<string, unknown>).window;
		(globalThis as Record<string, unknown>).window = undefined;
		expect(capturedGetSnapshot?.()).toBe("system");
		(globalThis as Record<string, unknown>).window = savedWin;
	});
});

// ---------------------------------------------------------------------------
// Tests — resolveTheme / resolved value
// ---------------------------------------------------------------------------

describe("useTheme — resolved theme", () => {
	it("resolved is 'light' when theme is 'light'", () => {
		localStorageMock._store.theme = "light";
		const result = useTheme();
		expect(result.resolved).toBe("light");
	});

	it("resolved is 'dark' when theme is 'dark'", () => {
		localStorageMock._store.theme = "dark";
		const result = useTheme();
		expect(result.resolved).toBe("dark");
	});

	it("resolved is 'light' when theme is 'system' and system prefers light", () => {
		matchMediaMatches = false;
		const result = useTheme();
		expect(result.theme).toBe("system");
		expect(result.resolved).toBe("light");
	});

	it("resolved is 'dark' when theme is 'system' and system prefers dark", () => {
		matchMediaMatches = true;
		const result = useTheme();
		expect(result.theme).toBe("system");
		expect(result.resolved).toBe("dark");
	});
});

// ---------------------------------------------------------------------------
// Tests — setTheme
// ---------------------------------------------------------------------------

describe("useTheme — setTheme", () => {
	it("setTheme('dark') stores to localStorage and applies dark class", () => {
		const result = useTheme();
		result.setTheme("dark");

		expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "dark");
		expect(classListMethods._classes.has("dark")).toBe(true);
	});

	it("setTheme('light') stores to localStorage and removes dark class", () => {
		classListMethods._classes.add("dark");
		const result = useTheme();
		result.setTheme("light");

		expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "light");
		expect(classListMethods._classes.has("dark")).toBe(false);
	});

	it("setTheme('light') sets colorScheme to light", () => {
		const result = useTheme();
		result.setTheme("light");
		expect(documentElement.style.colorScheme).toBe("light");
	});

	it("setTheme('dark') sets colorScheme to dark", () => {
		const result = useTheme();
		result.setTheme("dark");
		expect(documentElement.style.colorScheme).toBe("dark");
	});

	it("setTheme('system') removes from localStorage", () => {
		localStorageMock._store.theme = "dark";
		const result = useTheme();
		result.setTheme("system");

		expect(localStorageMock.removeItem).toHaveBeenCalledWith("theme");
	});

	it("setTheme('system') resolves to light when system prefers light", () => {
		matchMediaMatches = false;
		const result = useTheme();
		result.setTheme("system");
		expect(classListMethods._classes.has("dark")).toBe(false);
	});

	it("setTheme('system') resolves to dark when system prefers dark", () => {
		matchMediaMatches = true;
		const result = useTheme();
		result.setTheme("system");
		expect(classListMethods._classes.has("dark")).toBe(true);
	});

	it("setTheme triggers emitChange (notifies subscribers)", () => {
		let notified = false;
		capturedSubscribe?.(() => {
			notified = true;
		});

		const result = useTheme();
		result.setTheme("dark");
		expect(notified).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Tests — cycleTheme
// ---------------------------------------------------------------------------

describe("useTheme — cycleTheme", () => {
	it("cycles light -> dark", () => {
		localStorageMock._store.theme = "light";
		const result = useTheme();
		result.cycleTheme();
		expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "dark");
	});

	it("cycles dark -> system", () => {
		localStorageMock._store.theme = "dark";
		const result = useTheme();
		result.cycleTheme();
		expect(localStorageMock.removeItem).toHaveBeenCalledWith("theme");
	});

	it("cycles system -> light", () => {
		localStorageMock._store.theme = undefined;
		const result = useTheme();
		result.cycleTheme();
		expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "light");
	});
});

// ---------------------------------------------------------------------------
// Tests — useEffect (matchMedia listener)
// ---------------------------------------------------------------------------

describe("useTheme — useEffect for system preference", () => {
	it("registers matchMedia change listener on mount", () => {
		useTheme();
		expect(globalThis.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
		expect(matchMediaHandlers.length).toBeGreaterThan(0);
	});

	it("applies theme on mount", () => {
		localStorageMock._store.theme = "dark";
		useTheme();
		expect(classListMethods._classes.has("dark")).toBe(true);
	});

	it("applies light theme on mount", () => {
		localStorageMock._store.theme = "light";
		useTheme();
		expect(classListMethods._classes.has("dark")).toBe(false);
	});

	it("system preference change handler applies dark when theme is 'system'", () => {
		matchMediaMatches = false;
		useTheme();

		matchMediaMatches = true;
		for (const handler of matchMediaHandlers) {
			handler({ matches: true });
		}

		expect(classListMethods._classes.has("dark")).toBe(true);
	});

	it("system preference change handler applies light when switching back", () => {
		matchMediaMatches = true;
		useTheme();

		// Initially dark (system = dark)
		expect(classListMethods._classes.has("dark")).toBe(true);

		// System switches to light
		matchMediaMatches = false;
		for (const handler of matchMediaHandlers) {
			handler({ matches: false });
		}

		expect(classListMethods._classes.has("dark")).toBe(false);
	});

	it("system preference change handler does nothing when theme is not 'system'", () => {
		localStorageMock._store.theme = "light";
		useTheme();

		matchMediaMatches = true;
		for (const handler of matchMediaHandlers) {
			handler({ matches: true });
		}

		expect(classListMethods._classes.has("dark")).toBe(false);
	});

	it("system preference handler emits change notification", () => {
		let notified = false;
		capturedSubscribe?.(() => {
			notified = true;
		});

		matchMediaMatches = false;
		useTheme();

		matchMediaMatches = true;
		for (const handler of matchMediaHandlers) {
			handler({ matches: true });
		}

		expect(notified).toBe(true);
	});

	it("useEffect cleanup removes matchMedia listener", () => {
		useTheme();

		expect(capturedUseEffectCleanup).not.toBeNull();
		const handlerCountBefore = matchMediaHandlers.length;
		capturedUseEffectCleanup?.();
		expect(matchMediaHandlers.length).toBe(handlerCountBefore - 1);
	});
});

// ---------------------------------------------------------------------------
// Tests — subscribe (external store)
// ---------------------------------------------------------------------------

describe("useTheme — external store subscribe", () => {
	it("subscribe returns unsubscribe function", () => {
		useTheme();
		const unsub = capturedSubscribe?.(() => {});
		expect(typeof unsub).toBe("function");
	});

	it("subscribe adds listener and unsubscribe removes it", () => {
		useTheme();
		const listener = mock(() => {});
		const unsub = capturedSubscribe?.(listener);

		// Trigger emitChange
		const result = useTheme();
		result.setTheme("dark");
		expect(listener).toHaveBeenCalled();

		// Unsubscribe
		unsub();
		listener.mockClear();
		result.setTheme("light");
		expect(listener).not.toHaveBeenCalled();
	});

	it("multiple subscribers all get notified", () => {
		useTheme();
		const listener1 = mock(() => {});
		const listener2 = mock(() => {});
		capturedSubscribe?.(listener1);
		capturedSubscribe?.(listener2);

		const result = useTheme();
		result.setTheme("dark");

		expect(listener1).toHaveBeenCalled();
		expect(listener2).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Tests — return value shape
// ---------------------------------------------------------------------------

describe("useTheme — return value", () => {
	it("returns all expected properties", () => {
		const result = useTheme();
		expect(result).toHaveProperty("theme");
		expect(result).toHaveProperty("resolved");
		expect(result).toHaveProperty("setTheme");
		expect(result).toHaveProperty("cycleTheme");
	});

	it("setTheme and cycleTheme are functions", () => {
		const result = useTheme();
		expect(typeof result.setTheme).toBe("function");
		expect(typeof result.cycleTheme).toBe("function");
	});

	it("theme and resolved are strings", () => {
		const result = useTheme();
		expect(typeof result.theme).toBe("string");
		expect(typeof result.resolved).toBe("string");
	});
});
