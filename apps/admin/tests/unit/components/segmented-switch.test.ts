// SegmentedSwitch — type contract + className token guards.
//
// Same convention as the other admin component tests (stat-card,
// user-edit-dialog): no DOM renderer, just lock the props surface and
// the className tokens that other code reads.
//
// The tokens we pin matter for the visual regression Zheng Li reported
// on the KV monitor page: the previous shadcn Tabs control was h-10
// and forced the page header to feel tall. SegmentedSwitch has to stay
// at standard control height (h-8 wrapper, h-6 inner buttons after
// p-1 padding) and use ARIA tablist semantics.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
	SegmentedOption,
	SegmentedSwitchProps,
} from "../../../src/components/admin/segmented-switch";

describe("SegmentedSwitch types", () => {
	it("accepts a typed value/options pair", () => {
		const opts: SegmentedOption<"a" | "b">[] = [
			{ value: "a", label: "Alpha" },
			{ value: "b", label: "Beta" },
		];
		const props: SegmentedSwitchProps<"a" | "b"> = {
			value: "a",
			onValueChange: (_v) => {},
			options: opts,
			ariaLabel: "Select section",
		};
		expect(props.value).toBe("a");
		expect(props.options).toHaveLength(2);
	});

	it("option supports an explicit ariaLabel for icon-only labels", () => {
		const opt: SegmentedOption<"x"> = {
			value: "x",
			label: "★",
			ariaLabel: "Starred",
		};
		expect(opt.ariaLabel).toBe("Starred");
	});
});

const SOURCE = readFileSync(
	fileURLToPath(new URL("../../../src/components/admin/segmented-switch.tsx", import.meta.url)),
	"utf8",
);

describe("SegmentedSwitch — pinned class tokens", () => {
	it("wrapper uses h-8 (standard admin control height)", () => {
		expect(SOURCE).toContain("h-8");
	});

	it("inner buttons use h-6 + px-3 + text-xs (compact pill)", () => {
		expect(SOURCE).toContain("h-6");
		expect(SOURCE).toContain("px-3");
		expect(SOURCE).toContain("text-xs");
	});

	it("active state uses bg-background + shadow-sm (lifts off the track)", () => {
		expect(SOURCE).toContain("bg-background");
		expect(SOURCE).toContain("shadow-sm");
	});

	it("track uses bg-secondary so it reads as a control surface", () => {
		expect(SOURCE).toContain("bg-secondary");
	});

	it("allows horizontal scroll on narrow viewports (overflow-x-auto)", () => {
		expect(SOURCE).toContain("overflow-x-auto");
	});

	it('uses ARIA tablist semantics (role="tablist" + role="tab" + aria-selected)', () => {
		expect(SOURCE).toContain('role="tablist"');
		expect(SOURCE).toContain('role="tab"');
		expect(SOURCE).toContain("aria-selected");
	});
});
