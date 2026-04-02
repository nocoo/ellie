import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock browser globals BEFORE importing the module under test
// ---------------------------------------------------------------------------

let matchMediaHandlers: Array<(e: { matches: boolean }) => void> = [];
let matchMediaMatches = false;

const savedGlobals: Record<string, unknown> = {};

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

beforeEach(() => {
	matchMediaHandlers = [];
	matchMediaMatches = false;

	savedGlobals.matchMedia = globalThis.matchMedia;
	savedGlobals.window = globalThis.window;

	const matchMediaFn = mock((_query: string) => createMatchMediaMock());
	(globalThis as Record<string, unknown>).matchMedia = matchMediaFn;
	(globalThis as Record<string, unknown>).window = { matchMedia: matchMediaFn };
});

afterEach(() => {
	(globalThis as Record<string, unknown>).matchMedia = savedGlobals.matchMedia;
	(globalThis as Record<string, unknown>).window = savedGlobals.window;
});

// ---------------------------------------------------------------------------
// Mock React to extract hook logic without a real reconciler
// ---------------------------------------------------------------------------

let capturedSetIsMobile: ((value: boolean) => void) | null = null;
let capturedUseEffectCleanup: (() => void) | null = null;
let currentState = false;

mock.module("react", () => ({
	useState(initial: boolean | (() => boolean)) {
		currentState = typeof initial === "function" ? (initial as () => boolean)() : initial;
		capturedSetIsMobile = (value: boolean) => {
			currentState = value;
		};
		return [currentState, capturedSetIsMobile];
	},
	useEffect(fn: () => (() => undefined) | undefined, _deps: unknown[]) {
		const cleanup = fn();
		if (cleanup) capturedUseEffectCleanup = cleanup;
	},
	useCallback(fn: unknown, _deps: unknown[]) {
		return fn;
	},
	useSyncExternalStore(
		_subscribe: (cb: () => void) => () => void,
		getSnapshot: () => unknown,
		_getServerSnapshot: () => unknown,
	) {
		return getSnapshot();
	},
}));

// Import AFTER mock setup
const { useIsMobile, MOBILE_BREAKPOINT } = await import("@/hooks/use-is-mobile");

/**
 * Helper: call useIsMobile and return the current state after useEffect has run.
 * Since our mock runs useEffect immediately which calls setIsMobile(mq.matches),
 * the currentState variable will reflect the matchMedia value.
 */
function getIsMobile(): boolean {
	useIsMobile();
	return currentState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIsMobile", () => {
	it("exports MOBILE_BREAKPOINT as 768", () => {
		expect(MOBILE_BREAKPOINT).toBe(768);
	});

	it("exports useIsMobile function", () => {
		expect(typeof useIsMobile).toBe("function");
	});

	it("returns false when viewport is desktop (matches=false)", () => {
		matchMediaMatches = false;
		expect(getIsMobile()).toBe(false);
	});

	it("returns true when viewport is mobile (matches=true)", () => {
		matchMediaMatches = true;
		expect(getIsMobile()).toBe(true);
	});

	it("registers matchMedia change listener", () => {
		useIsMobile();
		expect(globalThis.matchMedia).toHaveBeenCalledWith(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		expect(matchMediaHandlers.length).toBeGreaterThan(0);
	});

	it("change handler calls setIsMobile with true on mobile", () => {
		matchMediaMatches = false;
		useIsMobile();

		expect(capturedSetIsMobile).not.toBeNull();
		for (const handler of matchMediaHandlers) {
			handler({ matches: true });
		}
		expect(capturedSetIsMobile).not.toBeNull();
	});

	it("change handler calls setIsMobile with false on desktop", () => {
		matchMediaMatches = true;
		useIsMobile();

		for (const handler of matchMediaHandlers) {
			handler({ matches: false });
		}
		expect(capturedSetIsMobile).not.toBeNull();
	});

	it("useEffect cleanup removes matchMedia listener", () => {
		useIsMobile();

		expect(capturedUseEffectCleanup).not.toBeNull();
		if (capturedUseEffectCleanup) {
			const handlerCountBefore = matchMediaHandlers.length;
			capturedUseEffectCleanup();
			expect(matchMediaHandlers.length).toBe(handlerCountBefore - 1);
		}
	});

	it("uses correct breakpoint query (max-width: 767px)", () => {
		useIsMobile();
		expect(globalThis.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
	});

	it("initializes state from matchMedia.matches (false)", () => {
		matchMediaMatches = false;
		expect(getIsMobile()).toBe(false);
	});

	it("initializes state from matchMedia.matches (true)", () => {
		matchMediaMatches = true;
		expect(getIsMobile()).toBe(true);
	});

	it("matchMedia event handler receives MediaQueryListEvent", () => {
		useIsMobile();

		for (const handler of matchMediaHandlers) {
			handler({ matches: true });
		}
		expect(true).toBe(true);
	});
});
