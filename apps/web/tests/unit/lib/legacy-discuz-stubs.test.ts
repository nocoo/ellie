// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	LEGACY_DISCUZ_STUBS_SCRIPT,
	LEGACY_DISCUZ_STUB_NAMES,
	type LegacyDiscuzStubTarget,
	installLegacyDiscuzStubs,
} from "@/lib/legacy-discuz-stubs";

// ---------------------------------------------------------------------------
// installLegacyDiscuzStubs — pure install on a target object
// ---------------------------------------------------------------------------

describe("installLegacyDiscuzStubs", () => {
	it("installs all three legacy globals on an empty target", () => {
		const target: LegacyDiscuzStubTarget = {};
		const installed = installLegacyDiscuzStubs(target);

		expect(installed.sort()).toEqual(["thumbImg", "attachimg", "img_onmouseoverfunc"].sort());
		for (const name of LEGACY_DISCUZ_STUB_NAMES) {
			expect(typeof target[name]).toBe("function");
		}
	});

	it("returns undefined for the no-op stubs (no DOM side-effects)", () => {
		const target: LegacyDiscuzStubTarget = {};
		installLegacyDiscuzStubs(target);

		// Each name is callable with arbitrary args (Discuz called these
		// with `(this)` and `(this, "load")`); none must throw, none must
		// return anything truthy.
		for (const name of LEGACY_DISCUZ_STUB_NAMES) {
			const fn = target[name] as (...args: unknown[]) => unknown;
			expect(fn(undefined)).toBeUndefined();
			expect(fn({}, "load")).toBeUndefined();
		}
	});

	it("preserves existing functions instead of overwriting them", () => {
		const original = () => "kept";
		const target: LegacyDiscuzStubTarget = { thumbImg: original };

		const installed = installLegacyDiscuzStubs(target);

		// Reviewer constraint: don't overwrite a real impl if someone
		// later wires one up.
		expect(target.thumbImg).toBe(original);
		expect(installed).not.toContain("thumbImg");
		expect(installed.sort()).toEqual(["attachimg", "img_onmouseoverfunc"].sort());
	});

	it("is idempotent: a second call installs nothing new", () => {
		const target: LegacyDiscuzStubTarget = {};
		installLegacyDiscuzStubs(target);
		const second = installLegacyDiscuzStubs(target);
		expect(second).toEqual([]);
	});

	it("treats non-function values as 'not installed' and replaces them", () => {
		// e.g. someone shadowed the name with a string in dev tools.
		const target: LegacyDiscuzStubTarget = { thumbImg: "stringified" };
		installLegacyDiscuzStubs(target);
		expect(typeof target.thumbImg).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// LEGACY_DISCUZ_STUBS_SCRIPT — the inline IIFE shipped via <head>
// ---------------------------------------------------------------------------

describe("LEGACY_DISCUZ_STUBS_SCRIPT (inline IIFE)", () => {
	beforeEach(() => {
		// happy-dom shares window across cases; reset before each.
		for (const name of LEGACY_DISCUZ_STUB_NAMES) {
			(window as unknown as Record<string, unknown>)[name] = undefined;
		}
	});

	afterEach(() => {
		for (const name of LEGACY_DISCUZ_STUB_NAMES) {
			(window as unknown as Record<string, unknown>)[name] = undefined;
		}
	});

	function evalScript() {
		// new Function avoids polluting the test module scope; the IIFE
		// references `window` directly so happy-dom's window is what gets
		// mutated.
		new Function(LEGACY_DISCUZ_STUBS_SCRIPT)();
	}

	it("defines all three legacy globals on window", () => {
		evalScript();
		const w = window as unknown as Record<string, unknown>;
		expect(typeof w.thumbImg).toBe("function");
		expect(typeof w.attachimg).toBe("function");
		expect(typeof w.img_onmouseoverfunc).toBe("function");
	});

	it("does not throw when invoked from an inline image handler", () => {
		evalScript();
		// Mirror the handler signatures observed in production:
		//   <img onload="thumbImg(this)">
		//   <img onload="attachimg(this, 'load')">
		//   <img onmouseover="img_onmouseoverfunc(this)">
		const img = document.createElement("img");
		const w = window as unknown as Record<string, (...args: unknown[]) => unknown>;
		expect(() => w.thumbImg(img)).not.toThrow();
		expect(() => w.attachimg(img, "load")).not.toThrow();
		expect(() => w.img_onmouseoverfunc(img)).not.toThrow();
	});

	it("does not overwrite a function already defined on window", () => {
		const w = window as unknown as Record<string, unknown>;
		const original = () => "real";
		w.thumbImg = original;

		evalScript();

		expect(w.thumbImg).toBe(original);
		// Other names still get installed.
		expect(typeof w.attachimg).toBe("function");
		expect(typeof w.img_onmouseoverfunc).toBe("function");
	});

	it("is safely idempotent: running the script twice changes nothing", () => {
		evalScript();
		const first = window.thumbImg;
		evalScript();
		expect(window.thumbImg).toBe(first);
	});

	it("triggers an actual <img> onload without console ReferenceError", () => {
		evalScript();
		// Wire an inline handler the same way historical post HTML does
		// — via the attribute, not addEventListener — and make sure
		// invoking it directly doesn't throw.
		const img = document.createElement("img");
		img.setAttribute("onload", "thumbImg(this)");
		// happy-dom doesn't auto-execute the attribute string, so call
		// the resulting handler manually. The point of the test is that
		// `thumbImg` is reachable on window.
		const handler = img.onload as ((ev: Event) => unknown) | null;
		// happy-dom may or may not parse the attribute as a real handler;
		// either way, calling window.thumbImg directly must not throw.
		const w = window as unknown as Record<string, (...args: unknown[]) => unknown>;
		expect(() => w.thumbImg(img)).not.toThrow();
		// If happy-dom DID parse it, exercise that path too.
		if (typeof handler === "function") {
			expect(() => handler.call(img, new Event("load"))).not.toThrow();
		}
	});
});
