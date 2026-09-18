// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureSettingsForm } from "@/components/admin/feature-settings-form";
import { SettingsForm } from "@/components/admin/settings-form";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe.each([
	{ Form: SettingsForm, label: "版权年份", value: "2001-2026" },
	{ Form: FeatureSettingsForm, label: "维护提示信息", value: "计划维护，请稍后再试" },
])("$label save feedback", ({ Form, label, value }) => {
	it("keeps edits and reports an error when the server confirms zero settings", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: { updated: 0 } })),
		);
		render(<Form initialSettings={{}} />);
		fireEvent.change(screen.getByLabelText(label), { target: { value } });
		fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
		expect((await screen.findByRole("alert")).textContent).toContain("设置未完整保存");
		expect(screen.queryByText(/已保存 \d/)).toBeNull();
		expect(screen.getByText("有未保存的更改")).toBeTruthy();
		expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
		expect(refresh).not.toHaveBeenCalled();
	});

	it("uses the confirmed values as the saved baseline despite a stale router refresh", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: { updated: 1 } })),
		);
		const { rerender } = render(<Form initialSettings={{}} />);
		fireEvent.change(screen.getByLabelText(label), { target: { value } });
		fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
		await screen.findByText("已保存 1 项设置");
		expect(refresh).toHaveBeenCalledTimes(1);
		rerender(<Form initialSettings={{}} />);
		expect(screen.queryByText("有未保存的更改")).toBeNull();
		expect(
			(screen.getByRole("button", { name: "保存", exact: true }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
	});

	it("keeps edits made during a pending save dirty", async () => {
		let resolve!: (response: Response) => void;
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((done) => {
						resolve = done;
					}),
			),
		);
		render(<Form initialSettings={{}} />);
		fireEvent.change(screen.getByLabelText(label), { target: { value } });
		fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
		fireEvent.change(screen.getByLabelText(label), { target: { value: `${value} 新编辑` } });
		await act(async () => resolve(Response.json({ data: { updated: 1 } })));
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
		expect(screen.getByText("有未保存的更改")).toBeTruthy();
		expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(`${value} 新编辑`);
	});
});
