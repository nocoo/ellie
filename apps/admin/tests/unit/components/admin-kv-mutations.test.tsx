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
	if (path.endsWith("operations")) return Response.json({ data: { rows: [] } });
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
				expect(new URL(url, "http://localhost").pathname).toBe("/api/admin/kv/delete");
				expect(JSON.parse(String(init.body))).toEqual({
					family: "settings:all",
					key: "settings:all",
				});
				if (attempts === 1) {
					if (failure === "network") throw new Error("Connection lost");
					return Response.json(
						{ error: { code: "UNAVAILABLE", message: "Connection lost" } },
						{ status: 500 },
					);
				}
				return Response.json({ data: { outcome: "deleted", deletedKeys: ["settings:all"] } });
			}),
		);
		render(<KvMonitorPage />);
		fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
		fireEvent.click(await screen.findByRole("button", { name: "删除此条缓存", exact: true }));
		const dialog = screen.getByRole("dialog", { name: "删除此条缓存" });
		expect(attempts).toBe(0);
		fireEvent.click(within(dialog).getByRole("button", { name: "删除此条缓存", exact: true }));
		await within(dialog).findByText(/Connection lost/);
		expect(dialog.isConnected).toBe(true);
		fireEvent.click(within(dialog).getByRole("button", { name: "删除此条缓存", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(attempts).toBe(2);
		await screen.findByText(/已发送删除 settings:all: settings:all/);
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
			return Response.json({ data: { outcome: "invalidated" } });
		}),
	);
	render(<KvMonitorPage />);
	const row = await screen.findByRole("row", { name: /Forum tree/ });
	fireEvent.click(within(row).getByRole("button", { name: "使一组缓存失效", exact: true }));
	const dialog = await screen.findByRole("dialog", { name: "使一组缓存失效" });
	fireEvent.click(within(dialog).getByRole("button", { name: "使一组缓存失效", exact: true }));
	await within(dialog).findByText(/Refresh connection lost/);
	expect(
		within(dialog)
			.getByRole("button", { name: "使一组缓存失效", exact: true })
			.hasAttribute("disabled"),
	).toBe(false);
	fireEvent.click(within(dialog).getByRole("button", { name: "使一组缓存失效", exact: true }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await screen.findByText(/已切换版本/);
	expect(attempts).toBe(2);
});

it("keeps the rebuild dialog open on BUSY and does not claim success", async () => {
	const familiesWithRebuild = families.map((row) =>
		row.family === "settings:all"
			? {
					...row,
					actions: {
						inspect: true,
						rebuild: true,
						deleteEntry: true,
						invalidateGroup: false,
						restriction: null,
					},
				}
			: row,
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url, "http://localhost").pathname;
			if (init?.method === "POST") {
				return Response.json({
					data: {
						outcome: "failed",
						stage: "validate",
						error: { code: "BUSY", message: "An earlier cache fill is still pending; retry later" },
					},
				});
			}
			if (path.endsWith("overview"))
				return Response.json({ data: { families: familiesWithRebuild } });
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "刷新此条缓存", exact: true }));
	const dialog = screen.getByRole("dialog", { name: "刷新此条缓存" });
	fireEvent.click(within(dialog).getByRole("button", { name: "刷新此条缓存", exact: true }));
	await within(dialog).findByText(/稍后重试/);
	expect(screen.queryByText(/已回填/)).toBeNull();
	expect(dialog.isConnected).toBe(true);
});

it("does not treat an unbound rebuild as success", async () => {
	const familiesWithRebuild = families.map((row) =>
		row.family === "settings:all"
			? {
					...row,
					actions: {
						inspect: true,
						rebuild: true,
						deleteEntry: true,
						invalidateGroup: false,
						restriction: null,
					},
				}
			: row,
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url, "http://localhost").pathname;
			if (init?.method === "POST") {
				expect(path).toBe("/api/admin/kv/rebuild");
				return Response.json({
					data: {
						outcome: "failed",
						stage: "load",
						error: {
							code: "INVALID_DESCRIPTOR",
							message: "Stored parameters and scope are required to rebuild this entry",
						},
					},
				});
			}
			if (path.endsWith("overview"))
				return Response.json({ data: { families: familiesWithRebuild } });
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "刷新此条缓存", exact: true }));
	const dialog = screen.getByRole("dialog", { name: "刷新此条缓存" });
	fireEvent.click(within(dialog).getByRole("button", { name: "刷新此条缓存", exact: true }));
	await within(dialog).findByText(/Stored parameters and scope are required to rebuild this entry/);
	expect(screen.queryByText(/已回填/)).toBeNull();
	expect(dialog.isConnected).toBe(true);
});

it("does not treat a group bump of !unavailable as content rebuild or success", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				return Response.json({
					data: {
						ok: false,
						outcome: "failed",
						error: {
							code: "KV_INVALIDATE_UNAVAILABLE",
							message: "generation bump was not confirmed",
						},
					},
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	const row = await screen.findByRole("row", { name: /Forum tree/ });
	fireEvent.click(within(row).getByRole("button", { name: "使一组缓存失效", exact: true }));
	const dialog = await screen.findByRole("dialog", { name: "使一组缓存失效" });
	fireEvent.click(within(dialog).getByRole("button", { name: "使一组缓存失效", exact: true }));
	await within(dialog).findByText(/generation bump was not confirmed/);
	expect(screen.queryByText(/已切换版本/)).toBeNull();
	expect(screen.queryByText(/已回填/)).toBeNull();
	expect(dialog.isConnected).toBe(true);
});

it("previews via inspect without posting rebuild params", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url, "http://localhost").pathname;
			expect(init?.method === "POST").toBeFalsy();
			if (path.endsWith("inspect")) {
				expect(path).toBe("/api/admin/kv/inspect");
				return Response.json({
					data: {
						family: "settings:all",
						key: "settings:all",
						rawKey: "settings:all",
						value: { siteName: "preview" },
						valueMasked: false,
						valueByteSize: 20,
						valid: true,
						status: "valid",
						scope: "public",
						params: {},
						metadata: null,
						expiration: null,
					},
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "查看", exact: true }));
	await screen.findByText(/siteName/);
});

it("rebuilds with only family and stored key, never caller params or scope", async () => {
	const familiesWithRebuild = families.map((row) =>
		row.family === "settings:all"
			? {
					...row,
					actions: {
						inspect: true,
						rebuild: true,
						deleteEntry: true,
						invalidateGroup: false,
						restriction: null,
					},
				}
			: row,
	);
	const posted: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url, "http://localhost").pathname;
			if (init?.method === "POST") {
				posted.push(JSON.parse(String(init.body)));
				expect(path).toBe("/api/admin/kv/rebuild");
				return Response.json({
					data: { outcome: "rebuilt", stage: "complete", scope: "public", params: {} },
				});
			}
			if (path.endsWith("overview")) {
				return Response.json({ data: { families: familiesWithRebuild } });
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "刷新此条缓存", exact: true }));
	const dialog = screen.getByRole("dialog", { name: "刷新此条缓存" });
	fireEvent.click(within(dialog).getByRole("button", { name: "刷新此条缓存", exact: true }));
	await screen.findByText(/已回填/);
	expect(posted).toEqual([{ family: "settings:all", key: "settings:all" }]);
});

it("shows occupancy from observed overview snapshots without inventing history", async () => {
	const familiesWithBytes = families.map((row) => ({
		...row,
		footprint: { kind: "observed" as const, bytes: 2048 },
	}));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("overview")) {
				return Response.json({ data: { families: familiesWithBytes, observedAt: 120_000 } });
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	await screen.findByText("Settings cache");
	await screen.findByText(/已发现 2/);
	await screen.findByText(/4.0 KiB/);
});

it("treats an empty registry payload as unavailable, not a healthy empty cache", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("overview")) return Response.json({ data: { families: [] } });
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	await screen.findByText(/未能获取缓存目录/);
});

it("keeps partial metrics visible and names the truncation instead of clearing the series", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("metrics")) {
				return Response.json({
					data: {
						minutes: 60,
						series: [{ family: "forum:tree:v2", tsMinute: 1, op: "hit", count: 2 }],
						truncated: true,
						coverage: "partial",
					},
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	await screen.findByText("Settings cache");
	expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	expect(screen.queryByText(/未能获取缓存目录/)).toBeNull();
});

it("surfaces metrics-unavailable notes without inventing a zero hit rate", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("metrics")) {
				return Response.json({
					data: { minutes: 60, series: [], note: "metrics table unavailable" },
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	await screen.findByText("Settings cache");
	expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	expect(screen.queryByText(/无请求/)).toBeNull();
});

it("shows an empty key list as not-yet-visited instead of a cache fault", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => readResponse(url, true)),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	await screen.findByText(/该类型当前没有已发现的条目/);
});

it("hides key names for hide families and still shows the family total", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("overview")) {
				return Response.json({
					data: {
						families: [
							{
								family: "refresh",
								displayName: "Refresh tokens",
								category: "session",
								status: "shipped",
								pattern: "refresh:<token>",
								ttl: "variable",
								nameSensitivity: "hide",
								valueSensitivity: "no-read",
								count: 3,
								truncated: false,
								presence: "sensitive-hidden",
								sampleKeys: [],
							},
						],
					},
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	await screen.findByText("Refresh tokens");
	await screen.findByText("敏感(隐藏)");
	expect(screen.getByRole("button", { name: "展开Refresh tokens" }).hasAttribute("disabled")).toBe(
		true,
	);
	expect(screen.queryByRole("button", { name: "查看", exact: true })).toBeNull();
});

it("labels inspect lifecycle as a diagnostic snapshot, not live content", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url, "http://localhost").pathname;
			expect(init?.method === "POST").toBeFalsy();
			if (path.endsWith("inspect")) {
				return Response.json({
					data: {
						family: "settings:all",
						key: "settings:all",
						rawKey: "settings:all",
						value: { siteName: "old" },
						valueMasked: false,
						valueByteSize: 16,
						status: "logically-expired",
						expiresAt: 1,
						scope: "public",
						params: {},
						metadata: null,
						expiration: null,
					},
				});
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "查看", exact: true }));
	await screen.findByText(/逻辑过期/);
	await screen.findByText(/仅作诊断快照，不是当前有效内容/);
});

it("locates by params JSON and scope instead of treating the box as a full key", async () => {
	const urls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			urls.push(String(url));
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Forum tree" }));
	await waitFor(() => expect(urls.some((url) => url.includes("/api/admin/kv/list"))).toBe(true));
	fireEvent.change(screen.getByLabelText("定位完整 key 或参数 JSON"), {
		target: { value: '{"forumId":1}' },
	});
	fireEvent.change(screen.getByLabelText("定位可见性范围"), { target: { value: "internal" } });
	fireEvent.click(screen.getByRole("button", { name: "定位" }));
	await waitFor(() => {
		expect(
			urls.some(
				(url) =>
					url.includes("/api/admin/kv/list") &&
					url.includes("params=") &&
					url.includes("scope=internal") &&
					!url.includes("key="),
			),
		).toBe(true);
	});
});

it("keeps inspect errors on the dialog instead of a blank preview", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url, "http://localhost").pathname;
			if (path.endsWith("inspect")) {
				return Response.json(
					{ error: { code: "KV_READ_FAILED", message: "get threw" } },
					{ status: 500 },
				);
			}
			return readResponse(url);
		}),
	);
	render(<KvMonitorPage />);
	fireEvent.click(await screen.findByRole("button", { name: "展开Settings cache" }));
	fireEvent.click(await screen.findByRole("button", { name: "查看", exact: true }));
	await screen.findByText(/加载失败：/);
	await screen.findByText(/get threw/);
});
