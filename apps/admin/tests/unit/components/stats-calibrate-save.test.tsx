// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatsCalibratePage from "@/app/(admin)/admin/statistics/calibrate/page";

const stored = {
	counters: [{ key: "stats.total_threads", stored: 10, real: null }],
	todayPosts: 2,
	todayDate: "2026-09-18",
};
const compared = { success: true, counters: [{ ...stored.counters[0], real: 12 }] };

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

async function openPage() {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ data: stored }))
		.mockResolvedValueOnce(Response.json({ data: compared }));
	vi.stubGlobal("fetch", fetch);
	render(<StatsCalibratePage />);
	await screen.findByLabelText("总主题数调整偏移");
	fireEvent.click(screen.getByRole("button", { name: "运行统计", exact: true }));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "同步真实值", exact: true }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	return fetch;
}

describe.each([
	{ button: "同步真实值", action: "apply_real", success: "已同步到真实值" },
	{ button: "应用偏移", action: "apply_offsets", success: "偏移量已应用" },
])("$button save confirmation", ({ button, action, success }) => {
	it.each([null, {}, { success: false }])(
		"does not report success for an unconfirmed response: %j",
		async (data) => {
			const fetch = await openPage();
			fetch.mockResolvedValueOnce(Response.json({ data }));
			fireEvent.change(screen.getByLabelText("总主题数调整偏移"), { target: { value: "2" } });
			fireEvent.click(screen.getByRole("button", { name: button, exact: true }));
			expect((await screen.findByRole("alert")).textContent).toContain("统计校准未确认保存");
			expect(screen.queryByText(success)).toBeNull();
			expect((screen.getByLabelText("总主题数调整偏移") as HTMLInputElement).value).toBe("2");
			expect(fetch).toHaveBeenCalledTimes(3);
			expect(JSON.parse(fetch.mock.calls[2][1].body).action).toBe(action);
		},
	);

	it("reports success and reloads only after explicit confirmation", async () => {
		const fetch = await openPage();
		fetch
			.mockResolvedValueOnce(Response.json({ data: { success: true } }))
			.mockResolvedValueOnce(
				Response.json({ data: { ...stored, counters: [{ ...stored.counters[0], stored: 12 }] } }),
			);
		fireEvent.change(screen.getByLabelText("总主题数调整偏移"), { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: button, exact: true }));
		await screen.findByText(success);
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

it("does not accept unconfirmed statistics as a fresh comparison", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ data: stored }))
		.mockResolvedValueOnce(Response.json({ data: { ...compared, success: false } }));
	vi.stubGlobal("fetch", fetch);
	render(<StatsCalibratePage />);
	await screen.findByLabelText("总主题数调整偏移");
	fireEvent.click(screen.getByRole("button", { name: "运行统计", exact: true }));
	await screen.findByRole("alert");
	expect(
		(screen.getByRole("button", { name: "同步真实值", exact: true }) as HTMLButtonElement).disabled,
	).toBe(true);
});
