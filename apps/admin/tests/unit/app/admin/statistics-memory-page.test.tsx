// /admin/statistics/memory page test — renders the frozen contract overview,
// wires confirm dialogs to instance-bound mutations, treats 409 as
// instance-change (refresh, no blind retry), and renders the
// config-missing state instead of an empty healthy cache.

// @vitest-environment happy-dom

import type { MemoryCacheOverview } from "@ellie/types";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

function makeOverview(overrides: Partial<MemoryCacheOverview> = {}): MemoryCacheOverview {
	return {
		instance: {
			id: "web-instance-1",
			version: "1.14.1",
			startedAt: "2026-09-23T09:00:00.000Z",
			uptimeMs: 120_000,
		},
		memory: {
			rssBytes: 64 * 1024 * 1024,
			heapUsedBytes: 16 * 1024 * 1024,
			estimatedPayloadBytes: 128 * 1024,
			payloadLimitBytes: 8 * 1024 * 1024,
		},
		families: [
			{
				id: "site-stats",
				entries: 1,
				maxEntries: 1,
				hits: 4,
				misses: 1,
				evictions: 0,
				loadErrors: 0,
			},
			{
				id: "forum-summary",
				entries: 3,
				maxEntries: 256,
				hits: 9,
				misses: 3,
				evictions: 1,
				loadErrors: 2,
			},
		],
		entries: [
			{
				family: "site-stats",
				key: "site:1",
				createdAt: "2026-09-23T09:01:00.000Z",
				expiresAt: "2026-09-23T09:06:00.000Z",
				estimatedBytes: 64,
				preview: '{"threads":10}',
			},
		],
		pagination: { page: 1, limit: 50, total: 1 },
		buffers: {
			pendingThreads: 2,
			pendingViews: 30,
			pendingUsers: 5,
			oldestPendingAt: "2026-09-23T09:04:00.000Z",
			flushing: false,
			lastFlushAt: "2026-09-23T09:03:00.000Z",
			lastSuccessAt: "2026-09-23T09:03:00.000Z",
			unconfirmedViews: 1,
			droppedViews: 0,
			droppedActivities: 0,
		},
		history: [
			{ at: "2026-09-23T09:01:00.000Z", estimatedPayloadBytes: 120, pendingViews: 10 },
			{ at: "2026-09-23T09:02:00.000Z", estimatedPayloadBytes: 128, pendingViews: 12 },
		],
		...overrides,
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { data: makeOverview() })));
	globalThis.fetch = fetchMock as never;
});

afterEach(() => {
	cleanup();
	globalThis.fetch = originalFetch;
});

async function loadPage() {
	const mod = await import("@/app/(admin)/admin/statistics/memory/page");
	return mod.default;
}

function getRequests() {
	return fetchMock.mock.calls.map(([url, init]) => ({
		url:
			new URL(String(url), "http://localhost").pathname +
			new URL(String(url), "http://localhost").search,
		method: (init as RequestInit | undefined)?.method ?? "GET",
		body: (init as RequestInit | undefined)?.body,
	}));
}

describe("MemoryCachePage", () => {
	it("closes a confirmation opened against an instance replaced by a poll", async () => {
		const Page = await loadPage();
		render(<Page />);
		fireEvent.click(await screen.findByRole("button", { name: "清除全部展示缓存" }));
		expect(screen.getByRole("dialog")).toBeTruthy();
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				data: makeOverview({ instance: { ...makeOverview().instance, id: "web-instance-2" } }),
			}),
		);
		fireEvent(document, new Event("visibilitychange"));
		await screen.findByText("web-instance-2");
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(getRequests().filter((r) => r.method === "POST")).toHaveLength(0);
	});

	it("queues an operation refresh behind a slow overview request", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByText("实例信息");
		let resolveOld!: (value: Response) => void;
		fetchMock.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					resolveOld = resolve;
				}),
		);
		fireEvent.click(screen.getByRole("button", { name: "刷新" }));
		fireEvent.click(screen.getByRole("button", { name: "清除全部展示缓存" }));
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", { name: "确认清除", exact: true }),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(fetchMock).toHaveBeenCalledTimes(3);
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				data: makeOverview({ entries: [], pagination: { page: 1, limit: 50, total: 0 } }),
			}),
		);
		resolveOld(jsonResponse(200, { data: makeOverview() }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
		await waitFor(() => expect(screen.queryByText("site:1")).toBeNull());
	});

	it("queues the newest family filter while an older read is pending", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByText("实例信息");
		let resolveOld!: (value: Response) => void;
		fetchMock.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					resolveOld = resolve;
				}),
		);
		fireEvent.click(screen.getByRole("button", { name: "刷新" }));
		fireEvent.click(screen.getByRole("combobox", { name: "按家族筛选条目" }));
		fireEvent.click(await screen.findByRole("option", { name: "主题计数" }));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		resolveOld(jsonResponse(200, { data: makeOverview() }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(getRequests()[2].url).toContain("family=thread-count");
	});

	it("renders instance, families, entries, buffers and history from one overview", async () => {
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByText("实例信息")).toBeTruthy();
		expect(screen.getByText("web-instance-1")).toBeTruthy();
		expect(screen.getByText("缓存家族")).toBeTruthy();
		expect(screen.getByText("站点统计")).toBeTruthy();
		expect(screen.getByText("版块摘要")).toBeTruthy();
		expect(screen.getByText("缓存条目")).toBeTruthy();
		expect(screen.getByText("site:1")).toBeTruthy();
		expect(screen.getByText("统计缓冲")).toBeTruthy();
		expect(screen.getByText("历史采样")).toBeTruthy();
		expect(screen.getByRole("button", { name: "立即冲刷" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "清除全部展示缓存" })).toBeTruthy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(getRequests()[0].url).toBe("/api/admin/memory-cache?page=1&limit=50");
	});

	it("flush posts the on-screen instanceId and reloads the overview", async () => {
		const Page = await loadPage();
		render(<Page />);
		fireEvent.click(await screen.findByRole("button", { name: "立即冲刷" }));
		const dialog = screen.getByRole("dialog", { name: "立即冲刷统计缓冲" });
		fireEvent.click(within(dialog).getByRole("button", { name: "确认冲刷", exact: true }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		const requests = getRequests();
		expect(requests[1]).toMatchObject({
			url: "/api/admin/memory-cache",
			method: "POST",
			body: JSON.stringify({ instanceId: "web-instance-1", action: "flush" }),
		});
		expect(requests[2].method).toBe("GET");
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("clears a single entry through the destructive confirm dialog", async () => {
		const Page = await loadPage();
		render(<Page />);
		fireEvent.click(await screen.findByRole("button", { name: "清除此条", exact: true }));
		const dialog = screen.getByRole("dialog", { name: "清除单个缓存条目" });
		fireEvent.click(within(dialog).getByRole("button", { name: "确认清除", exact: true }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(getRequests()[1].body).toBe(
			JSON.stringify({
				instanceId: "web-instance-1",
				action: "clear",
				family: "site-stats",
				key: "site:1",
			}),
		);
	});

	it("treats 409 INSTANCE_CONFLICT as an instance change: banner + reload, no retry", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByText("实例信息");
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				jsonResponse(409, {
					error: { code: "INSTANCE_CONFLICT", message: "Memory cache instance changed" },
				}),
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "清除全部展示缓存" }));
		const dialog = screen.getByRole("dialog", { name: "清除全部展示缓存" });
		fireEvent.click(within(dialog).getByRole("button", { name: "确认清除", exact: true }));
		await screen.findByText(/实例已变更/);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		const posts = getRequests().filter((r) => r.method === "POST");
		expect(posts).toHaveLength(1);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("treats an unavailable mutation response as uncertain and refreshes without retry", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByText("实例信息");
		fireEvent.click(screen.getAllByRole("button", { name: "清除整组" })[0]);
		const dialog = screen.getByRole("dialog", { name: "清除家族 站点统计" });
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				jsonResponse(502, {
					error: {
						code: "UPSTREAM_UNAVAILABLE",
						message: "Memory cache management is unavailable",
					},
				}),
			),
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "确认清除", exact: true }));
		await screen.findByText(/操作结果尚未确认/);
		expect(screen.queryByRole("dialog")).toBeNull();
		await waitFor(() => expect(getRequests().filter((r) => r.method === "GET")).toHaveLength(2));
		expect(getRequests().filter((r) => r.method === "POST")).toHaveLength(1);
	});

	it("renders the config-missing state instead of an empty cache", async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(
				jsonResponse(503, {
					error: { code: "NOT_CONFIGURED", message: "Memory cache management is not configured" },
				}),
			),
		);
		const Page = await loadPage();
		render(<Page />);
		expect(await screen.findByText("管理通道未配置")).toBeTruthy();
		expect(screen.getByText(/WEB_MEMORY_ADMIN_URL/)).toBeTruthy();
		expect(screen.getByText(/不会回退到任意来源/)).toBeTruthy();
		expect(screen.queryByText("实例信息")).toBeNull();
		expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
	});

	it("shows a restart notice when the instance id changes between reads", async () => {
		const Page = await loadPage();
		render(<Page />);
		await screen.findByText("实例信息");
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				jsonResponse(200, {
					data: makeOverview({ instance: { ...makeOverview().instance, id: "web-instance-2" } }),
				}),
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "刷新" }));
		expect(await screen.findByText(/实例重启/)).toBeTruthy();
		expect(screen.getByText("web-instance-2")).toBeTruthy();
	});
});
