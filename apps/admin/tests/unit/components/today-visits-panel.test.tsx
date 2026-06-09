// TodayVisitsPanel component test — P5 reviewer follow-up.
//
// Pins the panel's frozen contract:
//   - KPI counter labeled "活跃用户/访客（含匿名）" renders the sum
//     `activeUsers + anonPresent` (NOT "独立访客").
//   - Each row's link target follows the frozen routing rule:
//       * thread → /admin/threads/<id>  (internal admin link)
//       * user   → /admin/users/<id>    (internal admin link)
//       * forum  → /forums/<id>         (public, target="_blank", rel includes noopener)
//       * any other path_kind → label only, NO <a> wrapper.
//   - Filter pills constrain the list query by `path_kind`; the
//     selection round-trips into the fetched URL exactly once per pill
//     click.

// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayVisitsPanel } from "@/components/admin/analytics/today-visits-panel";

// Default payloads. Per-test overrides via fetchMock impl.
const KPI_PAYLOAD = {
	now: 1_700_000_000,
	dateLocal: "2026-05-20",
	totalViews: 1234,
	humanViews: 1000,
	botSearchViews: 150,
	botOtherViews: 50,
	unknownViews: 34,
	distinctTargets: 87,
	activeUsers: 25,
	anonPresent: 1,
	byPathKind: [
		{ pathKind: "thread", views: 800, targets: 60 },
		{ pathKind: "forum", views: 234, targets: 12 },
	],
};

const ROW_THREAD = {
	pathKind: "thread",
	targetId: 7,
	label: "Hello world",
	views: 100,
	humanViews: 80,
	botSearchViews: 12,
	botOtherViews: 5,
	unknownViews: 3,
	uniqueUsers: 25,
	firstSeenAt: 1000,
	lastSeenAt: 2000,
};

const ROW_USER = {
	pathKind: "user",
	targetId: 11,
	label: "alice",
	views: 50,
	humanViews: 40,
	botSearchViews: 6,
	botOtherViews: 2,
	unknownViews: 2,
	uniqueUsers: 15,
	firstSeenAt: 900,
	lastSeenAt: 1900,
};

const ROW_FORUM = {
	pathKind: "forum",
	targetId: 3,
	label: "技术",
	views: 200,
	humanViews: 180,
	botSearchViews: 12,
	botOtherViews: 5,
	unknownViews: 3,
	uniqueUsers: 30,
	firstSeenAt: 800,
	lastSeenAt: 1800,
};

const ROW_HOME = {
	pathKind: "home",
	targetId: 0,
	label: "",
	views: 300,
	humanViews: 280,
	botSearchViews: 15,
	botOtherViews: 3,
	unknownViews: 2,
	uniqueUsers: 50,
	firstSeenAt: 700,
	lastSeenAt: 1700,
};

const LIST_PAYLOAD = {
	page: 1,
	limit: 20,
	total: 4,
	rows: [ROW_THREAD, ROW_USER, ROW_FORUM, ROW_HOME],
};

type FetchInit = RequestInit | undefined;

function makeJsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ data }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// vitest root config sets `pool: "threads"` with `isolate: false`. We
// only touch `globalThis.fetch` and restore by direct reference rather
// than `vi.restoreAllMocks()` so we do NOT clobber peer suites' own
// `vi.fn()` mocks running on the same thread.
let originalFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	cleanup();
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
});

afterAll(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
});

describe("TodayVisitsPanel — KPI render", () => {
	it("renders activeUsers+anonPresent under the reviewer-pinned label", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);

		// KPI label is the reviewer-pinned wording.
		await waitFor(() => {
			expect(screen.queryByText("活跃用户/访客（含匿名）")).not.toBeNull();
		});

		// MUST NOT use "独立访客" wording (reviewer pin).
		expect(screen.queryByText(/独立访客/)).toBeNull();

		// activeUsers (25) + anonPresent (1) → 26.
		const labelCell = screen.getByText("活跃用户/访客（含匿名）");
		const cell = labelCell.parentElement;
		expect(cell?.textContent).toContain("26");
	});

	it("activeUsers alone when anonPresent=0", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) {
				return makeJsonResponse({ ...KPI_PAYLOAD, activeUsers: 10, anonPresent: 0 });
			}
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);

		await waitFor(() => {
			expect(screen.queryByText("活跃用户/访客（含匿名）")).not.toBeNull();
		});

		const labelCell = screen.getByText("活跃用户/访客（含匿名）");
		const cell = labelCell.parentElement;
		expect(cell?.textContent).toContain("10");
	});
});

describe("TodayVisitsPanel — row link routing (frozen)", () => {
	it("thread row links to /admin/threads/:id (internal)", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(screen.queryByText("Hello world")).not.toBeNull();
		});

		const threadLink = screen.getByText("Hello world").closest("a");
		expect(threadLink).not.toBeNull();
		expect(threadLink?.getAttribute("href")).toBe("/admin/threads/7");
		expect(threadLink?.getAttribute("target")).not.toBe("_blank");
	});

	it("user row links to /admin/users/:id (internal)", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(screen.queryByText("alice")).not.toBeNull();
		});

		const userLink = screen.getByText("alice").closest("a");
		expect(userLink).not.toBeNull();
		expect(userLink?.getAttribute("href")).toBe("/admin/users/11");
		expect(userLink?.getAttribute("target")).not.toBe("_blank");
	});

	it("forum row links to public /forums/:id with target=_blank + noopener", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(screen.queryByText("技术")).not.toBeNull();
		});

		const forumLink = screen.getByText("技术").closest("a");
		expect(forumLink).not.toBeNull();
		expect(forumLink?.getAttribute("href")).toBe("/forums/3");
		expect(forumLink?.getAttribute("target")).toBe("_blank");
		const rel = forumLink?.getAttribute("rel") ?? "";
		expect(rel).toContain("noopener");
	});

	it("non-id buckets (home) render the label-only — no anchor", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			// "首页" appears once as a filter pill and once as the row label.
			expect(screen.queryAllByText("首页").length).toBeGreaterThanOrEqual(1);
		});

		// Locate the row-level "首页" span by walking up to a <td>. The
		// pill is a <button>, so closest("a") on either node MUST be null.
		const homeNodes = screen.getAllByText("首页");
		for (const n of homeNodes) {
			expect(n.closest("a")).toBeNull();
		}
	});
});

describe("TodayVisitsPanel — filter wiring", () => {
	it("clicking a path_kind pill round-trips into the list fetch URL", async () => {
		const observedList: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: FetchInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			if (url.includes("/today/visits/list")) {
				observedList.push(url);
				return makeJsonResponse(LIST_PAYLOAD);
			}
			return new Response("not found", { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(observedList.length).toBeGreaterThanOrEqual(1);
		});

		// Initial load: no path_kind query.
		expect(observedList[0]).not.toContain("path_kind=");

		// Click the "主题" filter pill (thread bucket).
		const pill = screen.getAllByRole("button", { name: "主题" })[0];
		await act(async () => {
			fireEvent.click(pill);
		});

		await waitFor(() => {
			expect(observedList.some((u) => u.includes("path_kind=thread"))).toBe(true);
		});
	});
});

describe("TodayVisitsPanel — error + edge paths", () => {
	it("renders KPI error message and list error message when both endpoints fail", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) {
				return new Response("boom", { status: 500 });
			}
			return new Response("boom-list", { status: 500 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);

		// KPI banner ("KPI 加载失败：…") and list banner ("明细加载失败：…").
		await waitFor(() => {
			expect(screen.queryByText(/KPI 加载失败/)).not.toBeNull();
		});
		await waitFor(() => {
			expect(screen.queryByText(/明细加载失败/)).not.toBeNull();
		});
	});

	it("renders empty state when list returns 0 rows", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse({ page: 1, limit: 20, total: 0, rows: [] });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(screen.queryByText("该筛选条件下暂无记录。")).not.toBeNull();
		});
	});

	it("renders label-only fallback (#id) when row label is empty but targetId > 0", async () => {
		// Build a thread row with empty label so the cond-expr at L64
		// (`row.label || (row.targetId > 0 ? `#${targetId}` : kindLabel)`)
		// falls into the `#${targetId}` branch.
		const blankThread = { ...ROW_THREAD, label: "" };
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse({ page: 1, limit: 20, total: 1, rows: [blankThread] });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			// Anchor still goes to /admin/threads/7; visible text is "#7".
			const a = document.querySelector('a[href="/admin/threads/7"]');
			expect(a).not.toBeNull();
		});
	});

	it("renders '—' for last-seen timestamp when row has firstSeenAt=lastSeenAt=0", async () => {
		const zeroTs = { ...ROW_THREAD, firstSeenAt: 0, lastSeenAt: 0 };
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse({ page: 1, limit: 20, total: 1, rows: [zeroTs] });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => {
			expect(screen.queryAllByText("—").length).toBeGreaterThan(0);
		});
		// Both first-seen and last-seen rows render the "—" placeholder
		// when their timestamps are 0 (the D0 v2 time-window contract).
		const dashes = screen.getAllByText("—");
		expect(dashes.length).toBe(2);
		// And both row prefix labels MUST be present.
		expect(screen.queryByText("首次：")).not.toBeNull();
		expect(screen.queryByText("最近：")).not.toBeNull();
	});

	it("renders the time-window column with both 首次 + 最近 labels and formatted timestamps", async () => {
		// firstSeenAt=1000, lastSeenAt=2000 → both formatted, both visible.
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse({
				page: 1,
				limit: 20,
				total: 1,
				rows: [{ ...ROW_THREAD, firstSeenAt: 1000, lastSeenAt: 2000 }],
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);

		// Column header must include the "首次 / 最近" wording per D0 pin.
		await waitFor(() => {
			expect(screen.queryByText(/首次\s*\/\s*最近/)).not.toBeNull();
		});
		// Both label prefixes must render in the row cell.
		expect(screen.queryByText("首次：")).not.toBeNull();
		expect(screen.queryByText("最近：")).not.toBeNull();
		// Neither timestamp should be "—" because both are >0.
		const dashes = screen.queryAllByText("—");
		expect(dashes.length).toBe(0);
	});

	it("clicking '全部' clears the path_kind filter on the next fetch", async () => {
		const observed: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			if (url.includes("/today/visits/list")) {
				observed.push(url);
				return makeJsonResponse(LIST_PAYLOAD);
			}
			return new Response("404", { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1));

		const pillThread = screen.getAllByRole("button", { name: "主题" })[0];
		await act(async () => {
			fireEvent.click(pillThread);
		});
		await waitFor(() => {
			expect(observed.some((u) => u.includes("path_kind=thread"))).toBe(true);
		});
		const pillAll = screen.getAllByRole("button", { name: "全部" })[0];
		await act(async () => {
			fireEvent.click(pillAll);
		});
		await waitFor(() => {
			// The last fetch must NOT contain `path_kind=`.
			const last = observed[observed.length - 1] ?? "";
			expect(last.includes("path_kind=")).toBe(false);
		});
	});

	it("clicking '下一页' advances page and '上一页' rolls back", async () => {
		// total = 60, limit = 20 → 3 pages, so both buttons are clickable.
		const PAGE_60 = { ...LIST_PAYLOAD, total: 60 };
		const observed: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/visits")) return makeJsonResponse(KPI_PAYLOAD);
			if (url.includes("/today/visits/list")) {
				observed.push(url);
				return makeJsonResponse(PAGE_60);
			}
			return new Response("404", { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<TodayVisitsPanel />);
		await waitFor(() => expect(observed.length).toBeGreaterThanOrEqual(1));

		const nextBtn = screen.getByRole("button", { name: "下一页" });
		await act(async () => {
			fireEvent.click(nextBtn);
		});
		await waitFor(() => {
			expect(observed.some((u) => u.includes("page=2"))).toBe(true);
		});

		const prevBtn = screen.getByRole("button", { name: "上一页" });
		await act(async () => {
			fireEvent.click(prevBtn);
		});
		await waitFor(() => {
			// After clicking back, the most recent fetch should be page=1.
			const last = observed[observed.length - 1] ?? "";
			expect(last.includes("page=1")).toBe(true);
		});
	});
});
