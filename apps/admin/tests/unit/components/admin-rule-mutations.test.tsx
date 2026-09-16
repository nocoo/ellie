// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CensorWordsPage from "@/app/(admin)/admin/censor-words/page";
import IpBansPage from "@/app/(admin)/admin/ip-bans/page";
import ReportsPage from "@/app/(admin)/admin/reports/page";

vi.mock("@/components/admin/ip-lookup-inline", () => ({ IpLookupInline: () => null }));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const word = {
	id: 9,
	find: "spam",
	replacement: "**",
	action: "replace",
	adminId: 0,
	adminName: "",
	createdAt: 0,
};
const ban = {
	id: 9,
	ip: "192.0.2.1",
	reason: "spam",
	expiresAt: null,
	adminId: 0,
	adminName: "",
	createdAt: 0,
};
const report = {
	id: 9,
	type: "thread",
	targetId: 12,
	threadId: 12,
	targetTitle: "Reported thread",
	targetName: null,
	reporterId: 3,
	reporterName: "reporter",
	reason: "spam",
	status: "pending",
	handlerId: null,
	handlerName: "",
	handledAt: null,
	createdAt: 0,
};

it.each(["censor", "ip", "reports"])(
	"keeps failed %s batch deletions selected and allows a confirmed retry",
	async (kind) => {
		let attempts = 0;
		let requestBody: unknown;
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).includes("batch-delete")) {
				attempts += 1;
				requestBody = JSON.parse(String(init?.body));
				return attempts === 1
					? Response.json(
							{ error: { code: "UNAVAILABLE", message: "Temporary failure" } },
							{ status: 500 },
						)
					: Response.json({ data: { affected: 1 } });
			}
			return Response.json({
				data: attempts > 1 ? [] : [kind === "censor" ? word : kind === "ip" ? ban : report],
				meta: { page: 1, pages: 1, limit: 20, total: attempts > 1 ? 0 : 1 },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			kind === "censor" ? <CensorWordsPage /> : kind === "ip" ? <IpBansPage /> : <ReportsPage />,
		);
		fireEvent.click(await screen.findByRole("checkbox", { name: "选择行 9" }));
		fireEvent.click(screen.getByRole("button", { name: "批量删除", exact: true }));
		const dialog = screen.getByRole("dialog", {
			name:
				kind === "censor" ? "批量删除敏感词" : kind === "ip" ? "批量删除 IP 封禁" : "批量删除举报",
		});
		expect(attempts).toBe(0);
		fireEvent.click(within(dialog).getByRole("button", { name: "确认", exact: true }));
		await within(dialog).findByText("Temporary failure");
		expect(requestBody).toEqual({ ids: [9] });
		expect(document.querySelector('[aria-label="选择行 9"]')?.getAttribute("aria-checked")).toBe(
			"true",
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "确认", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(attempts).toBe(2);
		expect(screen.queryByRole("region", { name: "批量操作" })).toBeNull();
	},
);

it("keeps a report detail open after deletion fails and closes it after a confirmed retry", async () => {
	let attempts = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				attempts += 1;
				expect(JSON.parse(String(init.body))).toEqual({ ids: [9] });
				return attempts === 1
					? Response.json(
							{ error: { code: "UNAVAILABLE", message: "Deletion failed" } },
							{ status: 500 },
						)
					: Response.json({ data: { affected: 1 } });
			}
			return Response.json({
				data: attempts > 1 ? [] : [report],
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
		}),
	);
	render(<ReportsPage />);
	fireEvent.click(await screen.findByRole("button", { name: "#9", exact: true }));
	const detail = screen.getByRole("dialog", { name: "举报详情 #9" });
	fireEvent.click(within(detail).getByRole("button", { name: "删除", exact: true }));
	const confirmation = screen.getByRole("dialog", { name: "删除举报", exact: true });
	expect(attempts).toBe(0);
	fireEvent.click(within(confirmation).getByRole("button", { name: "确认", exact: true }));
	await within(confirmation).findByText("Deletion failed");
	expect(detail.isConnected).toBe(true);
	fireEvent.click(within(confirmation).getByRole("button", { name: "确认", exact: true }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(attempts).toBe(2);
});

it("locks report actions while updating status and preserves the detail and error for retry", async () => {
	let attempts = 0;
	let finishRequest!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "PATCH") {
				attempts += 1;
				expect(JSON.parse(String(init.body))).toEqual({ status: "resolved" });
				return attempts === 1
					? new Promise<Response>((resolve) => {
							finishRequest = resolve;
						})
					: Response.json({ data: { ...report, status: "resolved" } });
			}
			return Response.json({
				data: [{ ...report, status: attempts > 1 ? "resolved" : "pending" }],
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
		}),
	);
	render(<ReportsPage />);
	fireEvent.click(await screen.findByRole("button", { name: "#9", exact: true }));
	const detail = screen.getByRole("dialog", { name: "举报详情 #9" });
	const resolveButton = within(detail).getByRole("button", { name: "标记已处理" });
	fireEvent.click(resolveButton);
	for (const label of ["标记已处理", "驳回举报", "删除", "关闭弹窗"]) {
		expect(
			within(detail).getByRole("button", { name: label, exact: true }).hasAttribute("disabled"),
		).toBe(true);
	}
	fireEvent.click(resolveButton);
	expect(attempts).toBe(1);
	await act(async () =>
		finishRequest(
			Response.json(
				{ error: { code: "UNAVAILABLE", message: "Status update failed" } },
				{ status: 500 },
			),
		),
	);
	await within(detail).findByText("Status update failed");
	expect(resolveButton.hasAttribute("disabled")).toBe(false);
	fireEvent.click(resolveButton);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(attempts).toBe(2);
});

it.each(["censor", "ip"])(
	"retains a failed %s create form and shows the API error",
	async (kind) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) =>
				init?.method === "POST"
					? Response.json(
							{ error: { code: "DUPLICATE", message: "Rule already exists" } },
							{ status: 409 },
						)
					: Response.json({ data: [], meta: { page: 1, pages: 0, limit: 20, total: 0 } }),
			),
		);
		render(kind === "censor" ? <CensorWordsPage /> : <IpBansPage />);
		fireEvent.click(
			screen.getByRole("button", {
				name: kind === "censor" ? "添加敏感词" : "添加封禁",
				exact: true,
			}),
		);
		const dialog = screen.getByRole("dialog");
		const field = within(dialog).getByLabelText(kind === "censor" ? "词语 / 正则" : "IP / 范围");
		fireEvent.change(field, { target: { value: kind === "censor" ? "spam" : "192.0.2.1" } });
		fireEvent.click(
			within(dialog).getByRole("button", {
				name: kind === "censor" ? "添加敏感词" : "创建封禁",
				exact: true,
			}),
		);
		await within(dialog).findByText("Rule already exists");
		expect((field as HTMLInputElement).value).toBe(kind === "censor" ? "spam" : "192.0.2.1");
	},
);
