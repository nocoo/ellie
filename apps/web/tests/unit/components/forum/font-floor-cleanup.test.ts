// @vitest-environment happy-dom
// Batch 4 — 12px floor cleanup: remaining UI components that still had
// `text-2xs` / `text-[10px]` after Batch 1-3. Pin them at `text-xs` so a
// future drift back below the 12px floor becomes a visible regression.

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, className, ...rest }: any) =>
		createElement("span", { className, ...rest }, children),
}));

// ─── ThreadListHeader ────────────────────────────────────────────────────────

import { ThreadListHeader } from "@/components/forum/thread-list-header";

afterEach(() => {
	cleanup();
});

describe("ThreadListHeader — 12px floor", () => {
	it("column header row uses text-xs (was text-2xs)", () => {
		render(createElement(ThreadListHeader));
		const header = screen.getByTestId("thread-list-header");
		expect(header.className).toContain("text-xs");
		expect(header.className).not.toContain("text-2xs");
	});
});

// ─── ThreadBadgeList ─────────────────────────────────────────────────────────

import { ThreadBadgeList } from "@/components/forum/thread-badge";

describe("ThreadBadgeList — 12px floor", () => {
	it("badge uses text-xs (was text-2xs); padding/leading preserved", () => {
		render(
			createElement(ThreadBadgeList, {
				badges: [{ type: "digest", label: "精华", variant: "success" }] as any,
			}),
		);
		const badge = screen.getByTestId("thread-badge");
		expect(badge.className).toContain("text-xs");
		expect(badge.className).not.toContain("text-2xs");
		// Padding/leading unchanged per "只改字体" reviewer instruction.
		expect(badge.className).toContain("px-1");
		expect(badge.className).toContain("py-0");
		expect(badge.className).toContain("leading-tight");
	});
});
