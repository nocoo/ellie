// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrendTab } from "@/components/admin/analytics/tabs/trend-tab";

vi.mock("@/components/admin/analytics/trend-chart", () => ({
	TrendChart: ({ series, valueLabel }: { series: { count: number }[]; valueLabel: string }) => (
		<section aria-label={valueLabel}>{series[0]?.count}</section>
	),
}));
vi.mock("@/components/admin/analytics/forum-dist-chart", () => ({ ForumDistChart: () => null }));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("cancels old ranges and keeps late results from replacing the selected period", async () => {
	let resolveFirst!: (value: Response) => void;
	let firstSignal: AbortSignal | null | undefined;
	const response = (data: unknown) => new Response(JSON.stringify({ data }));
	vi.stubGlobal(
		"fetch",
		vi.fn((input: string, init: RequestInit) => {
			const url = new URL(input, "http://localhost");
			if (url.pathname.endsWith("/trend") && url.searchParams.get("range") === "7d") {
				firstSignal = init.signal;
				return new Promise<Response>((resolve) => {
					resolveFirst = resolve;
				});
			}
			return Promise.resolve(
				response({
					metric: "users",
					range: "30d",
					series: [{ date: "2026-09-16", count: 20 }],
					rows: [],
				}),
			);
		}),
	);
	render(<TrendTab />);
	fireEvent.click(screen.getByRole("radio", { name: "近 30 天" }));
	await waitFor(() => expect(screen.getByLabelText("新注册").textContent).toBe("20"));
	expect(firstSignal?.aborted).toBe(true);
	await act(async () =>
		resolveFirst(
			response({ metric: "users", range: "7d", series: [{ date: "2026-09-16", count: 999 }] }),
		),
	);
	expect(screen.getByLabelText("新注册").textContent).toBe("20");
});
