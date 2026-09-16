// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CensorWordsPage from "@/app/(admin)/admin/censor-words/page";
import IpBansPage from "@/app/(admin)/admin/ip-bans/page";

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

it.each(["censor", "ip"])(
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
				data: attempts > 1 ? [] : [kind === "censor" ? word : ban],
				meta: { page: 1, pages: 1, limit: 20, total: attempts > 1 ? 0 : 1 },
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		render(kind === "censor" ? <CensorWordsPage /> : <IpBansPage />);
		fireEvent.click(await screen.findByRole("checkbox", { name: "选择行 9" }));
		fireEvent.click(screen.getByRole("button", { name: "批量删除", exact: true }));
		const dialog = screen.getByRole("dialog", {
			name: kind === "censor" ? "批量删除敏感词" : "批量删除 IP 封禁",
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
