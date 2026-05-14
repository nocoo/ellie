// @vitest-environment happy-dom
// Tests for UserProfileListRow — the shared 5-segment row used by all three
// user-profile tabs (主题 / 回复 / 精华). Verifies link targets, forum-chip
// fallback, time-source resolution, and `displayTime` precedence.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/forum/thread-badge", () => ({
	ThreadBadgeList: () => null,
}));

vi.mock("@/viewmodels/forum/thread-list", () => ({
	filterIconRedundantBadges: (b: unknown[]) => b,
	getDigestIconSrc: () => null,
	getThreadIconSrc: () => "/static/folder_common.gif",
	highlightStyle: () => undefined,
}));

// Capture the timestamp passed into formatRelativeTime so we can assert which
// time the row chose without depending on locale-sensitive output.
const formatRelativeTime = vi.fn((t: number) => `t=${t}`);
vi.mock("@/viewmodels/shared/formatting", () => ({
	formatCompactNumber: (n: number) => String(n),
	formatRelativeTime: (t: number) => formatRelativeTime(t),
}));

import { UserProfileListRow } from "@/components/forum/user-profile-list-row";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThread(overrides: Record<string, unknown> = {}) {
	return {
		id: 42,
		forumId: 5,
		subject: "Hello World",
		replies: 7,
		views: 100,
		createdAt: 1_700_000_000,
		lastPostAt: 1_710_000_000,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		typeName: "",
		...overrides,
	};
}

const forumsById = { 5: "灌水区", 2: "技术区" } as const;

afterEach(() => {
	cleanup();
	formatRelativeTime.mockClear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UserProfileListRow", () => {
	it("renders title link pointing to /threads/:id", () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
			}),
		);
		const titleLinks = screen.getAllByText("Hello World");
		expect(titleLinks.length).toBeGreaterThan(0);
		expect(titleLinks[0].closest("a")?.getAttribute("href")).toBe("/threads/42");
	});

	it("renders forum chip linking to /forums/:forumId when name is known", () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
			}),
		);
		const chips = screen.getAllByText("灌水区");
		expect(chips.length).toBeGreaterThan(0);
		expect(chips[0].closest("a")?.getAttribute("href")).toBe("/forums/5");
	});

	it("omits the forum chip when forumId is not in the map", () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread({ forumId: 999 }),
				forumsById,
			}),
		);
		// No "灌水区"/"技术区" text should appear since 999 is unknown.
		expect(screen.queryByText("灌水区")).toBeNull();
		expect(screen.queryByText("技术区")).toBeNull();
	});

	it('timeSource="lastPost" prefers lastPostAt over createdAt', () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
				timeSource: "lastPost",
			}),
		);
		expect(formatRelativeTime).toHaveBeenCalled();
		const args = formatRelativeTime.mock.calls.map((c) => c[0]);
		// Every call should use lastPostAt
		expect(args.every((t) => t === 1_710_000_000)).toBe(true);
	});

	it('timeSource="created" uses createdAt', () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
				timeSource: "created",
			}),
		);
		const args = formatRelativeTime.mock.calls.map((c) => c[0]);
		expect(args.every((t) => t === 1_700_000_000)).toBe(true);
	});

	it('timeSource="lastPost" falls back to createdAt when lastPostAt is missing', () => {
		// `??` semantics: only `null`/`undefined` trigger the fallback. Numeric 0
		// stays 0 — that's intentional (matches existing thread-list-row behavior).
		render(
			createElement(UserProfileListRow, {
				thread: makeThread({ lastPostAt: undefined }),
				forumsById,
				timeSource: "lastPost",
			}),
		);
		const args = formatRelativeTime.mock.calls.map((c) => c[0]);
		expect(args.every((t) => t === 1_700_000_000)).toBe(true);
	});

	it("displayTime wins over timeSource (回复 Tab semantics)", () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
				timeSource: "lastPost",
				displayTime: 1_234_567_890,
			}),
		);
		const args = formatRelativeTime.mock.calls.map((c) => c[0]);
		expect(args.every((t) => t === 1_234_567_890)).toBe(true);
	});

	it("renders replies and views in the stats segment", () => {
		render(
			createElement(UserProfileListRow, {
				thread: makeThread({ replies: 99, views: 1234 }),
				forumsById,
			}),
		);
		// Desktop + mobile each render once, so multiple matches.
		expect(screen.getAllByText(/99回 · 1234览/).length).toBeGreaterThan(0);
	});

	it("desktop layout exposes the 5-column grid (icon/title/forum/stats/time)", () => {
		// The three profile tabs share PROFILE_ROW_GRID_COLS — these data-testid
		// hooks are how we guarantee no future refactor silently collapses the
		// row back to a single flex line.
		render(
			createElement(UserProfileListRow, {
				thread: makeThread(),
				forumsById,
			}),
		);
		expect(screen.getByTestId("row-col-icon")).toBeTruthy();
		expect(screen.getByTestId("row-col-title")).toBeTruthy();
		expect(screen.getByTestId("row-col-forum")).toBeTruthy();
		expect(screen.getByTestId("row-col-stats")).toBeTruthy();
		expect(screen.getByTestId("row-col-time")).toBeTruthy();
	});

	it("UserProfileListHeader renders the four labeled columns above the rows", async () => {
		const { UserProfileListHeader } = await import("@/components/forum/user-profile-list-row");
		render(createElement(UserProfileListHeader));
		const header = screen.getByTestId("user-profile-list-header");
		// Header text must include all four column labels — icon column is blank.
		expect(header.textContent).toContain("主题");
		expect(header.textContent).toContain("板块");
		expect(header.textContent).toContain("回复 · 查看");
		expect(header.textContent).toContain("时间");
	});
});
