// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// next/link → plain anchor for href assertions
vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

import type { ForumThreadType } from "@ellie/types";
import { ThreadTypeFilter } from "@/components/forum/thread-type-filter";

const mkType = (id: number, name: string): ForumThreadType => ({
	id,
	name,
	displayOrder: 0,
	icon: "",
	enabled: true,
	moderatorOnly: false,
});

const TYPES: ForumThreadType[] = [mkType(11, "求购"), mkType(12, "出售"), mkType(13, "置换")];

afterEach(() => {
	cleanup();
});

describe("<ThreadTypeFilter />", () => {
	it("renders 全部 + every type as pills", () => {
		render(createElement(ThreadTypeFilter, { forumId: 134, types: TYPES, activeTypeId: null }));

		// "全部" is the unfilter pill
		expect(screen.getByText("全部")).toBeTruthy();
		for (const t of TYPES) {
			expect(screen.getByText(t.name)).toBeTruthy();
		}
	});

	it("returns null when no types are provided (no UI noise)", () => {
		const { container } = render(
			createElement(ThreadTypeFilter, { forumId: 134, types: [], activeTypeId: null }),
		);
		expect(container.firstChild).toBeNull();
	});

	it("marks 全部 active when activeTypeId is null", () => {
		render(createElement(ThreadTypeFilter, { forumId: 134, types: TYPES, activeTypeId: null }));
		const allPill = screen.getByText("全部").closest("button");
		expect(allPill?.getAttribute("aria-pressed")).toBe("true");
	});

	it("marks the matching type pill active when activeTypeId is set", () => {
		render(createElement(ThreadTypeFilter, { forumId: 134, types: TYPES, activeTypeId: 12 }));
		// 出售 is id=12 — active, rendered as a real button
		const sellPill = screen.getByText("出售").closest("button");
		expect(sellPill?.getAttribute("aria-pressed")).toBe("true");

		// 全部 is inactive, rendered via `render: <Link>` → an anchor
		const allPill = screen.getByText("全部").closest("a");
		expect(allPill?.getAttribute("aria-pressed")).toBe("false");
	});

	it("generates URLs via buildForumListUrl — 全部 has no typeId, types include typeId, no page", () => {
		// Use activeTypeId=11 so 全部 is rendered as a link (with href cleared)
		render(createElement(ThreadTypeFilter, { forumId: 134, types: TYPES, activeTypeId: 11 }));

		// 全部 should be a link with no typeId (clearing the filter resets
		// pagination — buildForumListUrl strips ?page=1).
		const allLink = screen.getByText("全部").closest("a") as HTMLAnchorElement | null;
		expect(allLink).toBeTruthy();
		expect(allLink?.getAttribute("href")).toBe("/forums/134");

		// 出售 is not active — should be a link with typeId=12
		const sellLink = screen.getByText("出售").closest("a") as HTMLAnchorElement | null;
		expect(sellLink?.getAttribute("href")).toBe("/forums/134?typeId=12");
	});

	it("active pill is disabled native button (no anchor link)", () => {
		render(createElement(ThreadTypeFilter, { forumId: 134, types: TYPES, activeTypeId: 11 }));
		// 求购 is active (id=11)
		const activePill = screen.getByText("求购").closest("button");
		expect(activePill?.hasAttribute("disabled")).toBe(true);
		// Should NOT be wrapped in an anchor
		expect(screen.getByText("求购").closest("a")).toBeNull();
	});
});
