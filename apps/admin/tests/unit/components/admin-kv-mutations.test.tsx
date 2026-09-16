// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import KvMonitorPage from "@/app/(admin)/admin/statistics/kv/page";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const families = [
	{ family: "settings:all", displayName: "Settings cache" },
	{ family: "forum:tree:v2", displayName: "Forum tree" },
].map((row) => ({
	...row,
	category: "cache",
	status: "shipped",
	pattern: row.family,
	ttl: 300,
	nameSensitivity: "public",
	valueSensitivity: "public",
	count: 1,
	truncated: false,
	presence: "present",
	sampleKeys: [],
}));

function readResponse(url: string, removed = false) {
	const path = new URL(url, "http://localhost").pathname;
	if (path.endsWith("overview")) return Response.json({ data: { families } });
	if (path.endsWith("metrics")) return Response.json({ data: { minutes: 60, series: [] } });
	return Response.json({
		data: {
			family: "settings:all",
			keys: removed ? [] : [{ key: "settings:all", rawKey: "settings:all", expiration: null }],
			cursor: null,
			listComplete: true,
		},
	});
}

it.each(["network", "http"])(
	"preserves a failed KV expiry confirmation after a %s error and allows retry",
	async (failure) => {
		let attempts = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				if (init?.method !== "POST") return readResponse(url, attempts > 1);
				attempts++;
				expect(JSON.parse(String(init.body))).toEqual({
					family: "settings:all",
					action: { kind: "delete-literal", key: "settings:all" },
				});
				if (attempts === 1) {
					if (failure === "network") throw new Error("Connection lost");
					return Response.json(
						{ error: { code: "UNAVAILABLE", message: "Connection lost" } },
						{ status: 500 },
					);
				}
				return Response.json({ data: { success: true } });
			}),
		);
		render(<KvMonitorPage />);
		fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
		fireEvent.click(await screen.findByRole("button", { name: "过期", exact: true }));
		const dialog = screen.getByRole("dialog", { name: "过期此 key" });
		expect(attempts).toBe(0);
		fireEvent.click(within(dialog).getByRole("button", { name: "过期", exact: true }));
		await within(dialog).findByText("Connection lost");
		expect(dialog.isConnected).toBe(true);
		fireEvent.click(within(dialog).getByRole("button", { name: "过期", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(attempts).toBe(2);
		await screen.findByText("已过期 settings:all: settings:all");
	},
);

it("shows a family refresh network failure and leaves refresh available for retry", async () => {
	let attempts = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method !== "POST") return readResponse(url);
			attempts++;
			expect(JSON.parse(String(init.body))).toEqual({
				family: "forum:tree:v2",
				action: { kind: "bump-forum-tree" },
			});
			if (attempts === 1) throw new Error("Refresh connection lost");
			return Response.json({ data: { success: true } });
		}),
	);
	render(<KvMonitorPage />);
	const row = await screen.findByRole("row", { name: /Forum tree/ });
	fireEvent.click(within(row).getByRole("button", { name: "刷新", exact: true }));
	await screen.findByText("Refresh connection lost");
	expect(
		within(row).getByRole("button", { name: "刷新", exact: true }).hasAttribute("disabled"),
	).toBe(false);
	fireEvent.click(within(row).getByRole("button", { name: "刷新", exact: true }));
	await screen.findByText("已刷新 forum:tree:v2");
	expect(attempts).toBe(2);
});
