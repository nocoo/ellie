// @vitest-environment happy-dom
// Tests for WriteGateDialogMount — verifies that the write-gate dialog renders
// the 3-step onboarding progress for new-user codes (EMAIL_NOT_VERIFIED /
// REQUIRE_AVATAR / MIN_REGISTRATION_DAYS), shows the right CTA per code, and
// omits the progress strip for other restriction codes.
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import { WriteGateDialogMount } from "@/components/forum/write-gate-dialog";
import { WRITE_GATE_EVENT } from "@/viewmodels/forum/write-gate";

afterEach(() => {
	cleanup();
	mockPush.mockReset();
});

function dispatchBlock(detail: { reason: string; code: string }) {
	act(() => {
		window.dispatchEvent(new CustomEvent(WRITE_GATE_EVENT, { detail }));
	});
}

describe("WriteGateDialogMount", () => {
	it("REQUIRE_AVATAR: shows reason, 3-step progress (done/current/pending), and 去设置头像 CTA", () => {
		render(createElement(WriteGateDialogMount));
		dispatchBlock({ reason: "请先设置头像后再发表内容", code: "REQUIRE_AVATAR" });

		expect(screen.getByText("无法发送内容")).toBeTruthy();
		expect(screen.getByText("请先设置头像后再发表内容")).toBeTruthy();

		const step1 = screen.getByTestId("write-gate-step-1");
		const step2 = screen.getByTestId("write-gate-step-2");
		const step3 = screen.getByTestId("write-gate-step-3");

		expect(step1.getAttribute("data-status")).toBe("done");
		expect(step2.getAttribute("data-status")).toBe("current");
		expect(step3.getAttribute("data-status")).toBe("pending");

		expect(step1.textContent).toContain("验证邮箱");
		expect(step2.textContent).toContain("设置头像");
		expect(step3.textContent).toContain("注册满一天");

		expect(screen.getByRole("button", { name: "去设置头像" })).toBeTruthy();
	});

	it("EMAIL_NOT_VERIFIED: step 1 current, others pending, CTA = 去验证邮箱", () => {
		render(createElement(WriteGateDialogMount));
		dispatchBlock({ reason: "请先验证邮箱后再进行操作", code: "EMAIL_NOT_VERIFIED" });

		expect(screen.getByTestId("write-gate-step-1").getAttribute("data-status")).toBe("current");
		expect(screen.getByTestId("write-gate-step-2").getAttribute("data-status")).toBe("pending");
		expect(screen.getByTestId("write-gate-step-3").getAttribute("data-status")).toBe("pending");
		expect(screen.getByRole("button", { name: "去验证邮箱" })).toBeTruthy();
	});

	it("MIN_REGISTRATION_DAYS: first two done, third current, no CTA button", () => {
		render(createElement(WriteGateDialogMount));
		dispatchBlock({ reason: "注册时间不足7天", code: "MIN_REGISTRATION_DAYS" });

		expect(screen.getByTestId("write-gate-step-1").getAttribute("data-status")).toBe("done");
		expect(screen.getByTestId("write-gate-step-2").getAttribute("data-status")).toBe("done");
		expect(screen.getByTestId("write-gate-step-3").getAttribute("data-status")).toBe("current");

		// Only the "知道了" close button should be present (no CTA for this code).
		expect(screen.queryByRole("button", { name: "去验证邮箱" })).toBeNull();
		expect(screen.queryByRole("button", { name: "去设置头像" })).toBeNull();
		expect(screen.getByText("知道了")).toBeTruthy();
	});

	it("unrelated restriction (e.g. CONTENT_DISABLED): no progress strip shown", () => {
		render(createElement(WriteGateDialogMount));
		dispatchBlock({ reason: "发帖暂停", code: "CONTENT_DISABLED" });

		expect(screen.queryByTestId("write-gate-step-1")).toBeNull();
		expect(screen.queryByTestId("write-gate-step-2")).toBeNull();
		expect(screen.queryByTestId("write-gate-step-3")).toBeNull();
		expect(screen.getByText("发帖暂停")).toBeTruthy();
	});
});
