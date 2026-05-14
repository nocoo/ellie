// @vitest-environment happy-dom
// Tests for UserPostsTab — covers the new `postsShape` discriminator and
// per-item defensive rendering. The shared row itself has its own test;
// this file only verifies that the tab wires `postsShape` correctly and
// never destructures `item.post` blindly.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Reuse a simple stub for the shared row — we only assert how many rows are
// rendered and that the right `displayTime` flows through.
const rowProps = vi.fn();
vi.mock("@/components/forum/user-profile-list-row", () => ({
	UserProfileListRow: (props: any) => {
		rowProps(props);
		return createElement("div", { "data-testid": "row" }, props.thread?.subject ?? "");
	},
}));

vi.mock("@/components/forum/empty-state", () => ({
	ForumEmptyState: ({ children }: any) =>
		createElement("div", { "data-testid": "empty" }, children),
}));

import { UserPostsTab } from "@/components/forum/user-posts-tab";

afterEach(() => {
	cleanup();
	rowProps.mockClear();
});

function emptyPosts() {
	return { items: [], nextCursor: null, prevCursor: null, total: 0 };
}

/** Full PostThreadSummary fixture — keeps row-required fields present. */
function makeItem(
	postOverrides: Record<string, unknown> = {},
	threadOverrides: Record<string, unknown> = {},
) {
	return {
		post: { id: 10, createdAt: 1_700_000_000, ...postOverrides },
		thread: {
			id: 1,
			forumId: 1,
			subject: "Hello",
			replies: 0,
			views: 0,
			createdAt: 100,
			lastPostAt: 100,
			closed: 0,
			sticky: 0,
			digest: 0,
			special: 0,
			highlight: 0,
			typeName: "",
			...threadOverrides,
		},
	};
}

const forumsById = { 1: "灌水区" } as const;

describe("UserPostsTab", () => {
	it("shows legacy notice when postsShape === 'legacy', regardless of items", () => {
		// Even if (in some inconsistent state) items leaked through, legacy
		// shape must hard-block rendering rows since we can't trust them.
		render(
			createElement(UserPostsTab, {
				posts: emptyPosts(),
				postsShape: "legacy",
				forumsById,
			}),
		);
		expect(screen.getByTestId("empty").textContent).toBe("回复列表暂不可用：后端接口待升级后显示");
		expect(screen.queryByTestId("row")).toBeNull();
	});

	it("shows '暂无回复' when history-shape but items is empty", () => {
		render(
			createElement(UserPostsTab, {
				posts: emptyPosts(),
				postsShape: "history",
				forumsById,
			}),
		);
		expect(screen.getByTestId("empty").textContent).toBe("暂无回复");
	});

	it("renders one row per valid item and forwards post.createdAt as displayTime", () => {
		render(
			createElement(UserPostsTab, {
				posts: {
					items: [makeItem()],
					nextCursor: null,
					prevCursor: null,
					total: 1,
				},
				postsShape: "history",
				forumsById,
			}),
		);
		expect(screen.getAllByTestId("row")).toHaveLength(1);
		const call = rowProps.mock.calls[0][0];
		expect(call.thread.id).toBe(1);
		expect(call.thread.subject).toBe("Hello");
		expect(call.displayTime).toBe(1_700_000_000);
	});

	it("skips malformed items rather than throwing (per-item guard)", () => {
		// Defense-in-depth: even if the server loader missed something, the
		// tab's `isUserPostHistoryItem` check must skip incomplete items.
		render(
			createElement(UserPostsTab, {
				posts: {
					items: [
						makeItem({ id: 10 }), // valid
						null,
						{} as any, // missing post AND thread
						{ post: null, thread: { id: 2, subject: "no-post" } },
						{ post: { id: 11, createdAt: 2 }, thread: null },
					],
					nextCursor: null,
					prevCursor: null,
					total: 5,
				},
				postsShape: "history",
				forumsById,
			}),
		);
		expect(screen.getAllByTestId("row")).toHaveLength(1);
	});

	it("skips items whose thread is missing row-required fields (replies/views/lastPostAt)", () => {
		// Even though `post` and `thread` envelopes look valid, missing
		// `replies` would crash `formatCompactNumber(thread.replies)` in the
		// real row. The guard catches this BEFORE the row sees it.
		const partialReplies = makeItem({ id: 10 }, { replies: undefined as unknown as number });
		const partialViews = makeItem({ id: 11 }, { views: undefined as unknown as number });
		const partialLastPostAt = makeItem({ id: 12 }, { lastPostAt: undefined as unknown as number });
		render(
			createElement(UserPostsTab, {
				posts: {
					items: [partialReplies, partialViews, partialLastPostAt, makeItem({ id: 99 })],
					nextCursor: null,
					prevCursor: null,
					total: 4,
				},
				postsShape: "history",
				forumsById,
			}),
		);
		// Only the fully-valid item should make it to the row.
		expect(screen.getAllByTestId("row")).toHaveLength(1);
		const call = rowProps.mock.calls[0][0];
		expect(call.thread.id).toBe(1);
		expect(call.displayTime).toBe(1_700_000_000);
	});
});
