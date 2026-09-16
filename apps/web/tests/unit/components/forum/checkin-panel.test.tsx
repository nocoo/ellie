// @vitest-environment happy-dom
import { CHECKIN_LEVELS, type UserCheckin } from "@ellie/types";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { post, success, error } = vi.hoisted(() => ({
	post: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/lib/api-client", async (original) => ({
	...(await original<Record<string, unknown>>()),
	apiClient: { post },
}));
vi.mock("@/components/forum/forum-toast", () => ({
	useForumToast: () => ({ success, error }),
}));
vi.mock("next/image", () => ({
	default: ({ unoptimized: _, alt, ...props }: Record<string, unknown>) => (
		<img alt={typeof alt === "string" ? alt : ""} {...props} />
	),
}));

import { CheckinPanel } from "@/components/forum/checkin-panel";

const checkin: UserCheckin = {
	userId: 7,
	totalDays: 12,
	monthDays: 4,
	streakDays: 2,
	rewardTotal: 37,
	lastReward: 3,
	mood: "kx",
	message: "今天很好",
	lastCheckinAt: 1789540000,
};

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("CheckinPanel", () => {
	it("submits the selected mood once and displays the returned rewards and history", async () => {
		let finish!: (value: unknown) => void;
		post.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		render(
			<CheckinPanel
				initial={{ checkin: null, checkedInToday: false, level: null, withinWindow: true }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "开心" }));
		fireEvent.change(screen.getByLabelText(/想说的话/), { target: { value: "  今天很好  " } });
		const form = screen.getByRole("button", { name: "签到", exact: true }).closest("form");
		if (!form) throw new Error("Check-in form is missing");
		await act(async () => {
			fireEvent.submit(form);
			fireEvent.submit(form);
		});
		expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/checkin", {
			mood: "kx",
			message: "今天很好",
		});
		await act(async () => {
			finish({ data: { checkin, reward: 3, level: CHECKIN_LEVELS[2] } });
		});
		expect(screen.getByRole("heading", { name: "今天已签到" })).toBeTruthy();
		for (const value of ["12 天", "2 天", "4 天", "37 同钱"])
			expect(screen.getByText(value)).toBeTruthy();
		expect(success).toHaveBeenCalledWith("签到成功！");
	});

	it.each([true, false])(
		"keeps history visible without allowing a write when checkedInToday=%s outside the window",
		(checkedInToday) => {
			render(
				<CheckinPanel
					initial={{ checkin, checkedInToday, level: CHECKIN_LEVELS[2], withinWindow: false }}
				/>,
			);
			expect(screen.queryByRole("button", { name: "签到", exact: true })).toBeNull();
			expect(screen.getByText("12 天")).toBeTruthy();
			expect(post).not.toHaveBeenCalled();
		},
	);
});
