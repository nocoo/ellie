// @vitest-environment happy-dom
// Tests for ForumRecommendedCard — the per-forum "推荐主题" card.
//
// Visibility contract (see component header):
//   - Empty list → renders nothing (card disappears entirely).
//   - Non-empty list → renders titled card listing 1..N threads with
//     subject (link), author name, and reply count.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("lucide-react", () => ({
	ThumbsUp: () => createElement("span", { "data-testid": "thumbsup" }),
}));

import { ForumRecommendedCard } from "@/components/forum/forum-recommended-card";
import type { RecommendedThreadItem } from "@/viewmodels/forum/recommended-threads.server";

function makeItem(overrides: Partial<RecommendedThreadItem> = {}): RecommendedThreadItem {
	return {
		id: 100,
		subject: "Test recommended thread",
		authorId: 7,
		authorName: "alice",
		replies: 3,
		lastPostAt: 1700000000,
		recommendedAt: 1700000000,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

describe("ForumRecommendedCard", () => {
	it("renders nothing for an empty list (card self-hides)", () => {
		const { container } = render(createElement(ForumRecommendedCard, { threads: [] }));
		// Empty list → null return; whole tree is empty.
		expect(container.firstChild).toBeNull();
	});

	it("renders the 推荐主题 heading and an item per thread", () => {
		const threads = [
			makeItem({ id: 555, subject: "newest", authorName: "alice", replies: 9 }),
			makeItem({ id: 320, subject: "older", authorName: "bob", replies: 0 }),
		];
		render(createElement(ForumRecommendedCard, { threads }));

		expect(screen.getByText("推荐主题")).toBeTruthy();

		// Both subjects are present as links to the canonical /threads/<id> path.
		const linkA = screen.getByText("newest").closest("a") as HTMLAnchorElement | null;
		const linkB = screen.getByText("older").closest("a") as HTMLAnchorElement | null;
		expect(linkA?.getAttribute("href")).toBe("/threads/555");
		expect(linkB?.getAttribute("href")).toBe("/threads/320");

		// Author + reply meta line is rendered alongside each subject.
		expect(screen.getByText(/alice · 9 回复/)).toBeTruthy();
		expect(screen.getByText(/bob · 0 回复/)).toBeTruthy();
	});

	it("preserves caller-provided thread ordering (the cap+sort happen server-side)", () => {
		// The component must NOT re-sort. Ordering is the server's job
		// (`r.thread_id DESC` in the worker query); the client just maps.
		// We verify this by passing items in a deliberately non-DESC order
		// and asserting the DOM order matches.
		const threads = [
			makeItem({ id: 50, subject: "first-in-array" }),
			makeItem({ id: 999, subject: "second-in-array" }),
		];
		render(createElement(ForumRecommendedCard, { threads }));
		const items = screen.getAllByRole("listitem");
		expect(items).toHaveLength(2);
		expect(items[0]?.textContent).toContain("first-in-array");
		expect(items[1]?.textContent).toContain("second-in-array");
	});

	// ─── iPhone mobile-trim contract (reviewer freeze msg=5a91dfd3) ─────
	// On phones the author+reply meta span is hidden (`hidden sm:inline`)
	// and the list grid collapses from 2 columns to 1 so long subjects
	// don't truncate at 320/375px.
	it("author + reply meta span carries `hidden sm:inline` (mobile hidden)", () => {
		const threads = [makeItem({ authorName: "alice", replies: 9 })];
		render(createElement(ForumRecommendedCard, { threads }));
		const meta = screen.getByTestId("forum-recommended-meta");
		expect(meta.className).toContain("hidden");
		expect(meta.className).toContain("sm:inline");
		// Text content still rendered (so desktop unchanged).
		expect(meta.textContent).toContain("alice");
		expect(meta.textContent).toContain("9 回复");
	});

	it("list grid is `grid-cols-1 sm:grid-cols-2` (mobile single column)", () => {
		const threads = [makeItem()];
		render(createElement(ForumRecommendedCard, { threads }));
		const list = screen.getByTestId("forum-recommended-list");
		expect(list.className).toContain("grid-cols-1");
		expect(list.className).toContain("sm:grid-cols-2");
	});
});
