// @vitest-environment happy-dom
// Tests for LoginForm — register dialog trigger
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/viewmodels/forum/auth", () => ({
	canSubmitLogin: () => false,
	loginErrorMessage: () => null,
}));

vi.mock("@/components/cap-widget", () => ({
	CapWidget: () => createElement("div", { "data-testid": "cap-widget" }),
}));

vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("div", { "data-testid": "forum-logo" }),
}));

vi.mock("@/app/(auth)/_components/auth-id-card", () => ({
	AuthIdCard: ({ children }: any) =>
		createElement("div", { "data-testid": "auth-id-card" }, children),
	AuthDivider: () => createElement("hr"),
	AuthErrorBanner: ({ message }: any) => createElement("div", { role: "alert" }, message),
	AuthHelpHint: ({ visible }: any) =>
		visible ? createElement("div", { "data-testid": "auth-help-hint" }) : null,
}));

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

// Mock Dialog components
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children }: any) => createElement("div", { "data-testid": "dialog" }, children),
	DialogTrigger: ({ render: renderProp }: any) =>
		createElement("div", { "data-testid": "dialog-trigger" }, renderProp),
	DialogContent: ({ children }: any) =>
		createElement("div", { "data-testid": "dialog-content" }, children),
	DialogHeader: ({ children }: any) =>
		createElement("div", { "data-testid": "dialog-header" }, children),
	DialogTitle: ({ children }: any) => createElement("h2", null, children),
	DialogDescription: ({ children }: any) => createElement("p", null, children),
}));

// Mock RegisterFormDialog
const registerFormDialogProps = vi.fn();
vi.mock("@/app/(auth)/register/register-form", () => ({
	RegisterFormDialog: (props: any) => {
		registerFormDialogProps(props);
		return createElement("div", { "data-testid": "register-form-dialog" });
	},
}));

// Import AFTER mocks
import LoginForm from "@/app/(auth)/login/login-form";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("NEXT_PUBLIC_CAP_API_ENDPOINT", "");
});

afterEach(cleanup);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LoginForm", () => {
	it("renders login fields", () => {
		render(createElement(LoginForm));
		expect(screen.getByPlaceholderText("请输入用户名")).toBeTruthy();
		expect(screen.getByPlaceholderText("请输入密码")).toBeTruthy();
	});

	it("renders register dialog trigger button", () => {
		render(createElement(LoginForm));
		expect(screen.getByText("创建新账号")).toBeTruthy();
	});

	it("renders register dialog content with title and description", () => {
		render(createElement(LoginForm));
		expect(screen.getByText("注册新账号")).toBeTruthy();
		expect(screen.getByText("创建您的同济网论坛账号")).toBeTruthy();
	});

	it("renders RegisterFormDialog inside dialog content", () => {
		render(createElement(LoginForm));
		expect(screen.getByTestId("register-form-dialog")).toBeTruthy();
	});

	it("passes onSuccess callback to RegisterFormDialog", () => {
		render(createElement(LoginForm));
		expect(registerFormDialogProps).toHaveBeenCalled();
		const props = registerFormDialogProps.mock.calls[0][0];
		expect(typeof props.onSuccess).toBe("function");
	});

	it("does not render Link to /register (uses dialog instead)", () => {
		render(createElement(LoginForm));
		const links = screen.queryAllByRole("link");
		const registerLink = links.find((el: HTMLElement) => el.getAttribute("href") === "/register");
		expect(registerLink).toBeUndefined();
	});
});
