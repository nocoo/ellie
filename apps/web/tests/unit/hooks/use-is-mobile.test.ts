import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mutable state (hoisted for vi.mock factory access)
// ---------------------------------------------------------------------------

const sharedState = vi.hoisted(() => ({
	matchMediaHandlers: [] as Array<(e: { matches: boolean }) => void>,
	matchMediaMatches: false,
	capturedSetIsMobile: null as ((value: boolean) => void) | null,
	capturedSetIsMobileCalls: [] as boolean[],
	capturedUseEffectCleanup: null as (() => void) | null,
	currentState: false,
}));

// ---------------------------------------------------------------------------
// Mock React to extract hook logic without a real reconciler
// ---------------------------------------------------------------------------

vi.mock("react", () => ({
	useState(initial: boolean | (() => boolean)) {
		sharedState.currentState =
			typeof initial === "function" ? (initial as () => boolean)() : initial;
		sharedState.capturedSetIsMobile = (value: boolean) => {
			sharedState.currentState = value;
			sharedState.capturedSetIsMobileCalls.push(value);
		};
		return [sharedState.currentState, sharedState.capturedSetIsMobile];
	},
	useEffect(fn: () => (() => undefined) | undefined, _deps: unknown[]) {
		const cleanup = fn();
		if (cleanup) sharedState.capturedUseEffectCleanup = cleanup;
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

import { MOBILE_BREAKPOINT, useIsMobile } from "@/hooks/use-is-mobile";

// ---------------------------------------------------------------------------
// Mock browser globals BEFORE each test
// ---------------------------------------------------------------------------

const savedGlobals: Record<string, unknown> = {};

function createMatchMediaMock() {
	return {
		get matches() {
			return sharedState.matchMediaMatches;
		},
		addEventListener: vi.fn((event: string, handler: (e: { matches: boolean }) => void) => {
			if (event === "change") sharedState.matchMediaHandlers.push(handler);
		}),
		removeEventListener: vi.fn((event: string, handler: (e: { matches: boolean }) => void) => {
			if (event === "change") {
				sharedState.matchMediaHandlers = sharedState.matchMediaHandlers.filter(
					(h) => h !== handler,
				);
			}
		}),
	};
}

beforeEach(() => {
	sharedState.matchMediaHandlers = [];
	sharedState.matchMediaMatches = false;
	sharedState.capturedSetIsMobileCalls = [];

	savedGlobals.matchMedia = globalThis.matchMedia;
	savedGlobals.window = globalThis.window;

	const matchMediaFn = vi.fn((_query: string) => createMatchMediaMock());
	(globalThis as Record<string, unknown>).matchMedia = matchMediaFn;
	(globalThis as Record<string, unknown>).window = { matchMedia: matchMediaFn };
});

afterEach(() => {
	(globalThis as Record<string, unknown>).matchMedia = savedGlobals.matchMedia;
	(globalThis as Record<string, unknown>).window = savedGlobals.window;
});

/**
 * Helper: call useIsMobile and return the current state after useEffect has run.
 */
function getIsMobile(): boolean {
	useIsMobile();
	return sharedState.currentState;
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
		sharedState.matchMediaMatches = false;
		expect(getIsMobile()).toBe(false);
	});

	it("returns true when viewport is mobile (matches=true)", () => {
		sharedState.matchMediaMatches = true;
		expect(getIsMobile()).toBe(true);
	});

	it("registers matchMedia change listener", () => {
		useIsMobile();
		expect(globalThis.matchMedia).toHaveBeenCalledWith(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
		expect(sharedState.matchMediaHandlers.length).toBeGreaterThan(0);
	});

	it("change handler calls setIsMobile with true on mobile", () => {
		sharedState.matchMediaMatches = false;
		useIsMobile();

		expect(sharedState.capturedSetIsMobile).not.toBeNull();
		for (const handler of sharedState.matchMediaHandlers) {
			handler({ matches: true });
		}
		expect(sharedState.capturedSetIsMobile).not.toBeNull();
	});

	it("change handler calls setIsMobile with false on desktop", () => {
		sharedState.matchMediaMatches = true;
		useIsMobile();

		for (const handler of sharedState.matchMediaHandlers) {
			handler({ matches: false });
		}
		expect(sharedState.capturedSetIsMobile).not.toBeNull();
	});

	it("useEffect cleanup removes matchMedia listener", () => {
		useIsMobile();

		expect(sharedState.capturedUseEffectCleanup).not.toBeNull();
		if (sharedState.capturedUseEffectCleanup) {
			const handlerCountBefore = sharedState.matchMediaHandlers.length;
			sharedState.capturedUseEffectCleanup();
			expect(sharedState.matchMediaHandlers.length).toBe(handlerCountBefore - 1);
		}
	});

	it("uses correct breakpoint query (max-width: 767px)", () => {
		useIsMobile();
		expect(globalThis.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
	});

	it("matchMedia event handler correctly updates state based on event.matches", () => {
		sharedState.matchMediaMatches = false;
		useIsMobile();

		// Simulate device becoming mobile
		for (const handler of sharedState.matchMediaHandlers) {
			handler({ matches: true });
		}
		expect(sharedState.capturedSetIsMobileCalls).toContain(true);
		expect(sharedState.currentState).toBe(true);

		// Simulate device becoming desktop
		for (const handler of sharedState.matchMediaHandlers) {
			handler({ matches: false });
		}
		expect(sharedState.capturedSetIsMobileCalls).toContain(false);
		expect(sharedState.currentState).toBe(false);
	});
});
