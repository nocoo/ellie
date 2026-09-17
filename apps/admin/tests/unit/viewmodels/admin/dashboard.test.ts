import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(admin)/admin/page";
import { fetchDashboardActivity, fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";

vi.mock("@/viewmodels/admin/dashboard.server", () => ({
	fetchDashboardStats: vi.fn(),
	fetchDashboardActivity: vi.fn(),
}));
vi.mock("@/components/admin/dashboard-activity", () => ({
	DashboardActivity: () => createElement("div", { "data-testid": "activity" }, "Loaded activity"),
}));
vi.mock("next/link", () => ({
	default: ({
		href,
		children,
		prefetch,
	}: {
		href: string;
		children: ReactNode;
		prefetch?: boolean;
	}) => createElement("a", { href, "data-prefetch": String(prefetch) }, children),
}));

beforeEach(() => {
	vi.mocked(fetchDashboardStats).mockResolvedValue({
		users: { total: null },
		threads: { total: 0 },
		posts: { total: 123 },
		source: "stored-counters",
		observedAt: 1,
	});
	vi.mocked(fetchDashboardActivity).mockResolvedValue({
		threads: null,
		posts: null,
		forums: null,
		visits: null,
		logins: null,
	});
});
afterEach(() => vi.clearAllMocks());

async function renderPage(statistics?: string | string[]) {
	const stream = await renderToReadableStream(
		await DashboardPage({ searchParams: Promise.resolve({ statistics }) }),
	);
	await stream.allReady;
	return new Response(stream).text();
}

describe("on-demand dashboard", () => {
	it.each([undefined, "0", ["1", "1"]])(
		"does not load statistics without explicit opt-in (%j)",
		async (statistics) => {
			const html = await renderPage(statistics);
			expect(fetchDashboardStats).not.toHaveBeenCalled();
			expect(fetchDashboardActivity).not.toHaveBeenCalled();
			expect(html).toContain('href="/admin?statistics=1" data-prefetch="false"');
			expect(html).toContain("加载统计");
			expect(html).not.toContain("Loaded activity");
			expect(html).toContain('href="/admin/analytics" data-prefetch="false"');
		},
	);

	it("loads requested totals and activity, preserving zero versus missing counts", async () => {
		const html = await renderPage("1");
		expect(fetchDashboardStats).toHaveBeenCalledOnce();
		expect(fetchDashboardActivity).toHaveBeenCalledOnce();
		expect(html).toContain("Loaded activity");
		expect(html).toContain('aria-label="累计用户 —"');
		expect(html).toContain('aria-label="累计主题 0"');
		expect(html).toContain('aria-label="累计帖子 123"');
		expect(html).toContain("收起统计");
		expect(html).toContain('href="/admin/statistics/calibrate" data-prefetch="false"');
	});

	it("shows a failed totals load without synthesizing counts and retains available activity", async () => {
		vi.mocked(fetchDashboardStats).mockRejectedValue(new Error("Stored counter unavailable"));
		const html = await renderPage("1");
		expect(html).toContain("Stored counter unavailable");
		expect(html).not.toContain('aria-label="累计用户');
		expect(html).toContain("Loaded activity");
	});
});
