import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(admin)/admin/page";
import { fetchDashboardActivity, fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

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
	vi.stubEnv("ADMIN_EMAILS", "admin@example.invalid");
	authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
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
		logins: null,
	});
});
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

async function renderPage() {
	const stream = await renderToReadableStream(await DashboardPage());
	await stream.allReady;
	return new Response(stream).text();
}

describe("automatic dashboard", () => {
	it.each([null, { user: { email: "outsider@example.invalid" } }])(
		"rejects an unauthorized session before loading statistics (%j)",
		async (session) => {
			authMock.mockResolvedValue(session);
			await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
			expect(fetchDashboardStats).not.toHaveBeenCalled();
			expect(fetchDashboardActivity).not.toHaveBeenCalled();
		},
	);

	it("loads totals and activity on entry, preserving zero versus missing counts", async () => {
		const html = await renderPage();
		expect(fetchDashboardStats).toHaveBeenCalledOnce();
		expect(fetchDashboardActivity).toHaveBeenCalledOnce();
		expect(html).toContain("Loaded activity");
		expect(html).toContain('aria-label="累计用户 —"');
		expect(html).toContain('aria-label="累计主题 0"');
		expect(html).toContain('aria-label="累计帖子 123"');
		expect(html).not.toContain("加载统计");
		expect(html).not.toContain("收起统计");
		expect(html).not.toContain("statistics=1");
		expect(html).toContain('href="/admin/analytics" data-prefetch="false"');
		expect(html).toContain('href="/admin/statistics/calibrate" data-prefetch="false"');
	});

	it("shows a failed totals load without synthesizing counts and retains available activity", async () => {
		vi.mocked(fetchDashboardStats).mockRejectedValue(new Error("Stored counter unavailable"));
		const html = await renderPage();
		expect(html).toContain("Stored counter unavailable");
		expect(html).not.toContain('aria-label="累计用户');
		expect(html).toContain("Loaded activity");
	});

	it("shows the default error for a non-Error rejection and still loads activity", async () => {
		vi.mocked(fetchDashboardStats).mockRejectedValue(null);
		const html = await renderPage();
		expect(html).toContain("统计数据加载失败");
		expect(html).not.toContain('aria-label="累计用户');
		expect(html).toContain("Loaded activity");
	});
});
