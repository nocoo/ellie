// Analytics page tab layout test.
//
// Pins the 3-tab split (趋势 / 审计 / 登录) added per zheng-li request
// msg=91189aa8. The 5-card "今日 KPI" row + page header stay above the
// SegmentedSwitch and are visible across all tabs; the tab panels mount
// the correct sub-component based on the active tab and `?tab=` deep links.

// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	searchParamsValue: "" as string,
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(hoisted.searchParamsValue),
}));

// Stub each tab to a sentinel so we can assert which one is mounted without
// pulling in the real chart / panel implementations and their fetches.
vi.mock("@/components/admin/analytics/tabs/trend-tab", () => ({
	TrendTab: () => <div data-testid="trend-tab">trend</div>,
}));
vi.mock("@/components/admin/analytics/tabs/audit-tab", () => ({
	AuditTab: () => <div data-testid="audit-tab">audit</div>,
}));
vi.mock("@/components/admin/analytics/tabs/login-tab", () => ({
	LoginTab: () => <div data-testid="login-tab">login</div>,
}));

// Skip the overview fetch — the KPI row is not what this test is about.
const mockOverview = {
	today: { newUsers: 1, newThreads: 2, newPosts: 3, checkins: 4 },
};
beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: true,
		json: async () => ({ data: mockOverview }),
	} as unknown as Response);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	hoisted.searchParamsValue = "";
});

async function loadPage() {
	return (await import("@/app/(admin)/admin/analytics/page")).default;
}

describe("AnalyticsPage — tab layout", () => {
	it("renders the 3 tabs in the SegmentedSwitch", async () => {
		const Page = await loadPage();
		render(<Page />);
		await waitFor(() => expect(screen.getByRole("tablist")).toBeTruthy());
		const tablist = screen.getByRole("tablist", { name: "切换数据分析视图" });
		const tabs = tablist.querySelectorAll('[role="tab"]');
		expect(tabs.length).toBe(3);
		expect(tabs[0].textContent).toContain("趋势");
		expect(tabs[1].textContent).toContain("审计");
		expect(tabs[2].textContent).toContain("登录");
	});

	it("defaults to the 趋势 tab when no ?tab= is provided", async () => {
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("trend-tab")).toBeTruthy();
		expect(screen.queryByTestId("audit-tab")).toBeNull();
		expect(screen.queryByTestId("login-tab")).toBeNull();
	});

	it("renders the 审计 tab when ?tab=audit", async () => {
		hoisted.searchParamsValue = "tab=audit";
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("audit-tab")).toBeTruthy();
		expect(screen.queryByTestId("trend-tab")).toBeNull();
		expect(screen.queryByTestId("login-tab")).toBeNull();
	});

	it("renders the 登录 tab when ?tab=login", async () => {
		hoisted.searchParamsValue = "tab=login";
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("login-tab")).toBeTruthy();
		expect(screen.queryByTestId("trend-tab")).toBeNull();
		expect(screen.queryByTestId("audit-tab")).toBeNull();
	});

	it("falls back to 趋势 for unknown ?tab= values", async () => {
		hoisted.searchParamsValue = "tab=banana";
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("trend-tab")).toBeTruthy();
	});

	it("switches tab content when a tab button is clicked", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByTestId("trend-tab");
		const auditTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("审计")) as HTMLElement;
		fireEvent.click(auditTab);
		expect(await screen.findByTestId("audit-tab")).toBeTruthy();
		expect(screen.queryByTestId("trend-tab")).toBeNull();
	});

	it("keeps the 今日 KPI row above the tabs and shared across tab switches", async () => {
		const Page = await loadPage();
		render(<Page />);
		await waitFor(() => expect(screen.getByText("今日新注册")).toBeTruthy());
		// Switch to login tab — KPI row stays visible.
		const loginTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("登录")) as HTMLElement;
		fireEvent.click(loginTab);
		await screen.findByTestId("login-tab");
		expect(screen.getByText("今日新注册")).toBeTruthy();
		expect(screen.getByText("今日签到")).toBeTruthy();
	});
});
