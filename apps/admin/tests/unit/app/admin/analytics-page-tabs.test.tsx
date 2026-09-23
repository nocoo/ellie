// Analytics page tab layout test.
//
// Pins the 2-tab split (趋势 / 登录) after the audit (today-visits) tab was
// retired with the memory-statistics migration. The "今日 KPI" row + page
// header stay above the Basalt tabs and are visible across all tabs; the tab
// panels mount the correct sub-component based on the active tab and `?tab=`
// deep links.

// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	searchParamsValue: "" as string,
	routerReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(hoisted.searchParamsValue),
	usePathname: () => "/admin/analytics",
	useRouter: () => ({
		replace: hoisted.routerReplace,
		push: vi.fn(),
		back: vi.fn(),
		forward: vi.fn(),
		refresh: vi.fn(),
		prefetch: vi.fn(),
	}),
}));

// Stub each tab to a sentinel so we can assert which one is mounted without
// pulling in the real chart / panel implementations and their fetches.
vi.mock("@/components/admin/analytics/tabs/trend-tab", () => ({
	TrendTab: () => <div data-testid="trend-tab">trend</div>,
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
	hoisted.routerReplace.mockReset();
});

async function loadPage() {
	return (await import("@/app/(admin)/admin/analytics/page")).default;
}

describe("AnalyticsPage — tab layout", () => {
	it("renders the 2 tabs in the Basalt tabs", async () => {
		const Page = await loadPage();
		render(<Page />);
		await waitFor(() => expect(screen.getByRole("tablist")).toBeTruthy());
		const tablist = screen.getByRole("tablist", { name: "切换数据分析视图" });
		const tabs = tablist.querySelectorAll('[role="tab"]');
		expect(tabs.length).toBe(2);
		expect(tabs[0].textContent).toContain("趋势");
		expect(tabs[1].textContent).toContain("登录");
	});

	it("defaults to the 趋势 tab when no ?tab= is provided", async () => {
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("trend-tab")).toBeTruthy();
		expect(screen.queryByTestId("login-tab")).toBeNull();
	});

	it("renders the 登录 tab when ?tab=login", async () => {
		hoisted.searchParamsValue = "tab=login";
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("login-tab")).toBeTruthy();
		expect(screen.queryByTestId("trend-tab")).toBeNull();
	});

	it("falls back to 趋势 for unknown ?tab= values (including retired audit)", async () => {
		hoisted.searchParamsValue = "tab=banana";
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByTestId("trend-tab")).toBeTruthy();
	});

	it("switches tab content when a tab button is clicked", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByTestId("trend-tab");
		const loginTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("登录")) as HTMLElement;
		fireEvent.mouseDown(loginTab, { button: 0, ctrlKey: false });
		expect(await screen.findByTestId("login-tab")).toBeTruthy();
		expect(screen.queryByTestId("trend-tab")).toBeNull();
	});

	it("writes the active tab back to the URL via router.replace", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByTestId("trend-tab");
		const loginTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("登录")) as HTMLElement;
		fireEvent.keyDown(loginTab, { key: "Enter" });
		expect(hoisted.routerReplace).toHaveBeenCalledTimes(1);
		expect(hoisted.routerReplace).toHaveBeenCalledWith("/admin/analytics?tab=login");
	});

	it("preserves other query params when writing the tab back to the URL", async () => {
		hoisted.searchParamsValue = "foo=bar";
		const Page = await loadPage();
		render(<Page />);
		await screen.findByTestId("trend-tab");
		const loginTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("登录")) as HTMLElement;
		fireEvent.mouseDown(loginTab, { button: 0, ctrlKey: false });
		expect(hoisted.routerReplace).toHaveBeenCalledTimes(1);
		const url = hoisted.routerReplace.mock.calls[0][0] as string;
		expect(url.startsWith("/admin/analytics?")).toBe(true);
		// Order-insensitive — URLSearchParams doesn't guarantee key order.
		const replacedParams = new URLSearchParams(url.split("?")[1]);
		expect(replacedParams.get("foo")).toBe("bar");
		expect(replacedParams.get("tab")).toBe("login");
	});

	it("keeps the 今日 KPI row above the tabs and shared across tab switches", async () => {
		const Page = await loadPage();
		render(<Page />);
		await waitFor(() => expect(screen.getByText("今日新注册")).toBeTruthy());
		// Switch to login tab — KPI row stays visible.
		const loginTab = screen
			.getAllByRole("tab")
			.find((el) => el.textContent?.includes("登录")) as HTMLElement;
		fireEvent.keyDown(loginTab, { key: "Enter" });
		await screen.findByTestId("login-tab");
		expect(screen.getByText("今日新注册")).toBeTruthy();
		expect(screen.getByText("今日签到")).toBeTruthy();
	});
});
