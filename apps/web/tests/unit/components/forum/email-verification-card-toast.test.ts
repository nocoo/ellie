// @vitest-environment happy-dom
// Tests for EmailVerificationCard toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const mockRefresh = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

// Mock cap-widget — auto-solves with a token
vi.mock("@/components/cap-widget", () => ({
	CapWidget: ({ onSolve }: any) => {
		// Auto-solve on mount
		if (onSolve) setTimeout(() => onSolve("cap-token-123"), 0);
		return createElement("div", { "data-testid": "cap-widget" }, "cap");
	},
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, onClick, disabled, type }: any) =>
		createElement("button", { type: type || "button", onClick, disabled }, children),
}));
vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: any) => createElement("div", null, children),
	CardContent: ({ children }: any) => createElement("div", null, children),
	CardHeader: ({ children }: any) => createElement("div", null, children),
	CardTitle: ({ children }: any) => createElement("h2", null, children),
}));
vi.mock("@/components/ui/input", () => ({
	Input: ({ id, value, onChange, disabled, placeholder, type }: any) =>
		createElement("input", {
			id,
			value,
			onChange,
			disabled,
			placeholder,
			type: type || "text",
			"aria-label": id,
		}),
}));
vi.mock("@/components/ui/label", () => ({
	Label: ({ children, htmlFor }: any) => createElement("label", { htmlFor }, children),
}));

import { EmailVerificationCard } from "@/components/forum/email-verification-card";
import { ForumToastProvider } from "@/components/forum/forum-toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderCard(email = "test@example.com") {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(EmailVerificationCard, {
				user: { email, emailVerifiedAt: 0 },
				capApiEndpoint: "https://cap.example.com/key/",
			}),
		),
	);
}

function renderCardWithRedirect(redirectTo: string, email = "test@example.com") {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(EmailVerificationCard, {
				user: { email, emailVerifiedAt: 0 },
				capApiEndpoint: "https://cap.example.com/key/",
				redirectAfterVerify: redirectTo,
			}),
		),
	);
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function mockFetchOk(data: Record<string, unknown> = {}) {
	return vi.fn().mockResolvedValueOnce(jsonResponse({ data }, 200));
}

function mockFetchError(status: number, body: unknown = null) {
	return vi.fn().mockResolvedValueOnce(jsonResponse(body ?? {}, status));
}

function mockFetchNetworkError() {
	return vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailVerificationCard toast integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	// --- Send code: success ---

	it("shows success toast on send code", async () => {
		global.fetch = mockFetchOk({ sent_to: "test@example.com", next_resend_allowed_at: 0 });
		renderCard();

		// Wait for CapWidget auto-solve
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		// Click send
		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("验证码已发送至"));
			expect(successToast).toBeTruthy();
		});
	});

	// --- Send code: API error (non-2xx) ---

	it("shows error toast on send code API failure", async () => {
		global.fetch = mockFetchError(400, {
			error: { code: "EMAIL_ALREADY_IN_USE", message: "该邮箱已被其他账户绑定。" },
		});
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("验证码发送失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("该邮箱已被其他账户绑定");
		});
	});

	// --- Send code: network error ---

	it("shows error toast on send code network failure", async () => {
		global.fetch = mockFetchNetworkError();
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("验证码发送失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("网络错误");
		});
	});

	// --- Verify: success ---

	it("shows success toast on verify", async () => {
		// First fetch: send code success
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			// Second fetch: verify success
			.mockResolvedValueOnce(jsonResponse({}, 200));
		global.fetch = fetchMock;
		renderCard();

		// Wait for cap auto-solve
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		// Send code first
		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		// Wait for code-sent state (code input appears)
		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		// Type code
		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		// Click verify
		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("邮箱已验证"));
			expect(successToast).toBeTruthy();
		});

		// Verify router.refresh() is still called after verify_success
		await waitFor(() => {
			expect(mockRefresh).toHaveBeenCalledTimes(1);
		});
	});

	// --- Verify: API error ---

	it("shows error toast on verify API failure", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			// Verify fails
			.mockResolvedValueOnce(
				jsonResponse({ error: { code: "CODE_INVALID", message: "验证码错误" } }, 400),
			);
		global.fetch = fetchMock;
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("邮箱验证失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("验证码错误");
		});
	});

	// --- Verify: network error ---

	it("shows error toast on verify network failure", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			// Verify network failure
			.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		global.fetch = fetchMock;
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("邮箱验证失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("网络错误");
		});
	});

	// --- redirectAfterVerify ---

	it("calls router.push(redirectAfterVerify) after verify success", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			.mockResolvedValueOnce(jsonResponse({}, 200));
		global.fetch = fetchMock;
		renderCardWithRedirect("/");

		// Wait for cap auto-solve
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		// Send code
		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		// Type code + verify
		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		// Wait for verified state (success banner confirms state transition)
		await waitFor(() => {
			expect(screen.getByRole("status")).toBeTruthy();
		});

		// After verify success, router.refresh should NOT be called
		expect(mockRefresh).not.toHaveBeenCalled();

		// router.push is called after 1.5s delay
		await waitFor(
			() => {
				expect(mockPush).toHaveBeenCalledWith("/");
			},
			{ timeout: 3000 },
		);
	});

	// --- CAPTCHA hidden after verify ---

	it("hides CAPTCHA widget after verify success", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			.mockResolvedValueOnce(jsonResponse({}, 200));
		global.fetch = fetchMock;
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		// CAPTCHA visible before verify
		expect(screen.getByTestId("cap-widget")).toBeTruthy();

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		// Wait for verified state — once the success banner is visible,
		// the CAPTCHA should already be gone.
		await waitFor(() => {
			expect(screen.getByRole("status")).toBeTruthy();
		});

		expect(screen.queryByTestId("cap-widget")).toBeNull();
	});

	// --- Success banner after verify ---

	it("shows success banner after verify", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ data: { sent_to: "test@example.com", next_resend_allowed_at: 0 } }, 200),
			)
			.mockResolvedValueOnce(jsonResponse({}, 200));
		global.fetch = fetchMock;
		renderCard();

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		const sendBtn = screen.getByText("发送验证码");
		await act(async () => {
			fireEvent.click(sendBtn);
		});

		await waitFor(() => {
			expect(screen.getByLabelText("code")).toBeTruthy();
		});

		const codeInput = screen.getByLabelText("code");
		await act(async () => {
			fireEvent.change(codeInput, { target: { value: "123456" } });
		});

		const verifyBtn = screen.getByText("验证");
		await act(async () => {
			fireEvent.click(verifyBtn);
		});

		// Success banner appears after verify — use the toast as the first
		// indicator (matches the passing test pattern).
		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("邮箱已验证"));
			expect(successToast).toBeTruthy();
		});

		// Success banner in the form
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("✓ 邮箱验证成功")).toBeTruthy();

		// Send/verify buttons gone
		expect(screen.queryByText("发送验证码")).toBeNull();
		expect(screen.queryByText("验证")).toBeNull();
	});
});
