// @vitest-environment happy-dom
// Tests for RegisterFormCore — dialog & standalone variants
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

// Mock server action
const mockRegisterUser = vi.fn();
vi.mock("@/actions/auth", () => ({
	registerUser: (...args: unknown[]) => mockRegisterUser(...args),
}));

// Mock browser API
vi.mock("@/lib/forum-browser-api", () => ({
	checkUsernameAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

// Mock next-auth
const mockSignIn = vi.fn();
vi.mock("next-auth/react", () => ({
	signIn: (...args: unknown[]) => mockSignIn(...args),
}));

// Mock cap widget
vi.mock("@/components/cap-widget", () => ({
	CapWidget: () => createElement("div", { "data-testid": "cap-widget" }),
}));

// Mock forum logo
vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("div", { "data-testid": "forum-logo" }),
}));

// Mock auth-id-card chrome
vi.mock("@/app/(auth)/_components/auth-id-card", () => ({
	AuthIdCard: ({ children }: any) =>
		createElement("div", { "data-testid": "auth-id-card" }, children),
	AuthDivider: () => createElement("hr"),
	AuthErrorBanner: ({ message }: any) => createElement("div", { role: "alert" }, message),
}));

// Mock UI components to simple HTML equivalents
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: any) =>
		createElement("button", { type: "button", ...props }, children),
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: any) => createElement("input", props),
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: any) => createElement("label", props, children),
}));

vi.mock("@/components/ui/select", () => ({
	Select: (props: any) => createElement("select", { ...props, "data-testid": props.id }),
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: any) => createElement("textarea", { ...props, "data-testid": props.id }),
}));

// Import AFTER mocks
import RegisterForm, { RegisterFormDialog } from "@/app/(auth)/register/register-form";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	// Ensure CAP is disabled in tests
	vi.stubEnv("NEXT_PUBLIC_CAP_API_ENDPOINT", "");
});

afterEach(cleanup);

// ─── Standalone variant ──────────────────────────────────────────────────────

describe("RegisterForm (standalone)", () => {
	it("renders inside AuthIdCard", () => {
		render(createElement(RegisterForm));
		expect(screen.getByTestId("auth-id-card")).toBeTruthy();
	});

	it("renders account fields", () => {
		render(createElement(RegisterForm));
		expect(screen.getByPlaceholderText("2-15 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("至少 6 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("再次输入密码")).toBeTruthy();
		expect(screen.getByPlaceholderText("your@email.com")).toBeTruthy();
	});

	it("renders profile fields section", () => {
		render(createElement(RegisterForm));
		// The collapsible details summary
		expect(screen.getByText("个人资料（选填）")).toBeTruthy();
	});

	it("renders profile input fields", () => {
		render(createElement(RegisterForm));
		// Profile fields are inside a details element (collapsed by default)
		// but they are in the DOM
		expect(screen.getByTestId("reg-gender")).toBeTruthy();
		expect(screen.getByPlaceholderText("如：四平路校区")).toBeTruthy();
		expect(screen.getByPlaceholderText("简单介绍自己")).toBeTruthy();
		expect(screen.getByPlaceholderText("一句话签名")).toBeTruthy();
	});

	it("renders posting conditions note", () => {
		render(createElement(RegisterForm));
		expect(screen.getByText("新用户须知")).toBeTruthy();
		expect(screen.getByText("注册后需完成邮箱验证方可发帖")).toBeTruthy();
	});
});

// ─── Dialog variant ──────────────────────────────────────────────────────────

describe("RegisterFormDialog", () => {
	it("renders profile fields in dialog variant", () => {
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		// Account fields
		expect(screen.getByPlaceholderText("2-15 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("your@email.com")).toBeTruthy();
		// Section headers
		expect(screen.getByText("账号信息")).toBeTruthy();
		expect(screen.getByText("个人资料（选填）")).toBeTruthy();
		// Profile fields
		expect(screen.getByTestId("reg-gender")).toBeTruthy();
		expect(screen.getByPlaceholderText("如：四平路校区")).toBeTruthy();
		expect(screen.getByPlaceholderText("毕业院校")).toBeTruthy();
		expect(screen.getByPlaceholderText("爱好特长")).toBeTruthy();
		expect(screen.getByPlaceholderText("QQ 号码")).toBeTruthy();
		expect(screen.getByPlaceholderText("https://...")).toBeTruthy();
		expect(screen.getByPlaceholderText("一句话签名")).toBeTruthy();
	});

	it("renders posting conditions note", () => {
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText("新用户须知")).toBeTruthy();
	});

	it("does not render AuthIdCard wrapper", () => {
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.queryByTestId("auth-id-card")).toBeNull();
	});
});

// ─── onSuccess logic ─────────────────────────────────────────────────────────

describe("onSuccess behavior", () => {
	it("does not call onSuccess when signIn fails", async () => {
		const onSuccess = vi.fn();
		mockRegisterUser.mockResolvedValue({ success: true });
		mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

		render(createElement(RegisterFormDialog, { onSuccess }));

		// Fill required fields
		const usernameInput = screen.getByPlaceholderText("2-15 个字符");
		const passwordInput = screen.getByPlaceholderText("至少 6 个字符");
		const confirmInput = screen.getByPlaceholderText("再次输入密码");
		const emailInput = screen.getByPlaceholderText("your@email.com");

		// Simulate input
		fireEvent.change(usernameInput, { target: { value: "testuser" } });
		fireEvent.change(passwordInput, { target: { value: "password123" } });
		fireEvent.change(confirmInput, { target: { value: "password123" } });
		fireEvent.change(emailInput, { target: { value: "test@example.com" } });

		// Submit
		const submitBtn = screen.getByText("创建账号");
		fireEvent.click(submitBtn);

		// Wait for async
		await vi.waitFor(() => {
			expect(mockRegisterUser).toHaveBeenCalled();
		});

		await vi.waitFor(() => {
			expect(mockSignIn).toHaveBeenCalled();
		});

		// onSuccess must NOT have been called
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("calls onSuccess when signIn succeeds", async () => {
		const onSuccess = vi.fn();
		mockRegisterUser.mockResolvedValue({ success: true });
		mockSignIn.mockResolvedValue({ ok: true });

		render(createElement(RegisterFormDialog, { onSuccess }));

		// Fill required fields
		fireEvent.change(screen.getByPlaceholderText("2-15 个字符"), {
			target: { value: "testuser" },
		});
		fireEvent.change(screen.getByPlaceholderText("至少 6 个字符"), {
			target: { value: "password123" },
		});
		fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
			target: { value: "password123" },
		});
		fireEvent.change(screen.getByPlaceholderText("your@email.com"), {
			target: { value: "test@example.com" },
		});

		fireEvent.click(screen.getByText("创建账号"));

		await vi.waitFor(() => {
			expect(mockSignIn).toHaveBeenCalled();
		});

		await vi.waitFor(() => {
			expect(onSuccess).toHaveBeenCalled();
		});
	});
});
