// @vitest-environment happy-dom
// Tests for LoginForm — register dialog trigger + CAP fail-closed behavior +
// submit-disable lock (success / failure / exception double-click protection).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CAP_ENV = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT;

afterAll(() => {
	if (ORIGINAL_CAP_ENV === undefined) {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
	} else {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = ORIGINAL_CAP_ENV;
	}
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
	canSubmitLogin: vi.fn(() => false),
	signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/viewmodels/forum/auth", () => ({
	canSubmitLogin: (...args: unknown[]) => hoisted.canSubmitLogin(...args),
	loginErrorMessage: (raw: unknown) => (raw ? `err:${String(raw)}` : null),
}));

vi.mock("next-auth/react", () => ({
	signIn: (...args: unknown[]) => hoisted.signIn(...args),
}));

// CapWidget mock: capture onSolve so tests can drive the token from outside
// the component via `act()`.
let capturedOnSolve: ((t: string) => void) | null = null;
vi.mock("@/components/cap-widget", () => ({
	CapWidget: ({ onSolve }: { onSolve?: (t: string) => void }) => {
		capturedOnSolve = onSolve ?? null;
		return createElement("div", { "data-testid": "cap-widget" });
	},
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

const registerFormDialogProps = vi.fn();
vi.mock("@/app/(auth)/register/register-form", () => ({
	RegisterFormDialog: (props: any) => {
		registerFormDialogProps(props);
		return createElement("div", { "data-testid": "register-form-dialog" });
	},
}));

async function loadLoginForm() {
	return await import("@/app/(auth)/login/login-form");
}

afterEach(cleanup);

// ─── CAP configured (production-like) ───────────────────────────────────────

describe("LoginForm — CAP configured", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
	});

	it("renders login fields", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByPlaceholderText("请输入用户名")).toBeTruthy();
		expect(screen.getByPlaceholderText("请输入密码")).toBeTruthy();
	});

	it("renders CAP widget", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByTestId("cap-widget")).toBeTruthy();
	});

	it("renders register dialog trigger button", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByText("创建新账号")).toBeTruthy();
	});

	it("renders register dialog content with title and description", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByText("注册新账号")).toBeTruthy();
		expect(screen.getByText("创建您的同济网论坛账号")).toBeTruthy();
	});

	it("renders RegisterFormDialog inside dialog content", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByTestId("register-form-dialog")).toBeTruthy();
	});

	it("passes onSuccess callback to RegisterFormDialog", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(registerFormDialogProps).toHaveBeenCalled();
		const props = registerFormDialogProps.mock.calls[0][0];
		expect(typeof props.onSuccess).toBe("function");
	});

	it("does not render Link to /register (uses dialog instead)", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		const links = screen.queryAllByRole("link");
		const registerLink = links.find((el: HTMLElement) => el.getAttribute("href") === "/register");
		expect(registerLink).toBeUndefined();
	});
});

// ─── CAP not configured — fail-closed ───────────────────────────────────────

describe("LoginForm — fail-closed when CAP not configured", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
	});

	it("does not render CAP widget", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.queryByTestId("cap-widget")).toBeNull();
	});

	it("renders fail-closed error banner", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		expect(screen.getByText(/人机验证服务未就绪/)).toBeTruthy();
	});

	it("submit button is disabled", async () => {
		const { default: LoginForm } = await loadLoginForm();
		render(createElement(LoginForm));
		const submitBtn = screen.getByText("登录");
		expect(submitBtn.closest("button")?.disabled).toBe(true);
	});
});

// ─── Submit-disable lock (success / failure / exception, double-click) ───────

describe("LoginForm — submit button disable lock", () => {
	const realLocation = window.location;
	let assignedHref: string | null;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		assignedHref = null;
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		// CAP token + non-empty username/password gate canSubmit on the
		// production path; we mock canSubmitLogin → true so the only gate
		// left is the in-flight lock under test.
		hoisted.canSubmitLogin.mockReturnValue(true);
		// Replace window.location with a stub that records assignments
		// without actually navigating in happy-dom.
		Object.defineProperty(window, "location", {
			configurable: true,
			value: {
				...realLocation,
				assign: (url: string) => {
					assignedHref = url;
				},
				replace: (url: string) => {
					assignedHref = url;
				},
				get href() {
					return assignedHref ?? "";
				},
				set href(url: string) {
					assignedHref = url;
				},
			},
		});
	});

	afterEach(() => {
		Object.defineProperty(window, "location", {
			configurable: true,
			value: realLocation,
		});
	});

	function submitForm(container: HTMLElement) {
		const form = container.querySelector("form");
		if (!form) throw new Error("form not found");
		fireEvent.submit(form);
	}

	function getSubmitButton(): HTMLButtonElement {
		const btn = screen
			.getAllByRole("button")
			.find((b) => /登录|登录中|正在跳转/.test(b.textContent ?? "")) as HTMLButtonElement;
		if (!btn) throw new Error("submit button not found");
		return btn;
	}

	async function flush() {
		// Drain microtasks for: dynamic import → signIn promise → setState batch.
		for (let i = 0; i < 5; i++) await Promise.resolve();
	}

	async function mountReady() {
		const { default: LoginForm } = await loadLoginForm();
		const utils = render(createElement(LoginForm));
		// Drive the CAP token through the captured onSolve so canSubmit=true.
		await act(async () => {
			capturedOnSolve?.("test-token");
		});
		return utils;
	}

	it("becomes disabled immediately after submit (in-flight)", async () => {
		// Pending signIn so we can observe the in-flight state.
		let resolveSignIn!: (v: unknown) => void;
		hoisted.signIn.mockImplementation(
			() =>
				new Promise((r) => {
					resolveSignIn = r;
				}),
		);
		const { container } = await mountReady();
		await act(async () => {
			submitForm(container);
			await flush();
		});
		const btn = getSubmitButton();
		expect(btn.disabled).toBe(true);
		expect(btn.textContent).toContain("登录中");
		// cleanup
		await act(async () => {
			resolveSignIn({ ok: true });
			await flush();
		});
	});

	it("ref-lock: rapid double-submit only fires signIn once", async () => {
		let resolveSignIn!: (v: unknown) => void;
		hoisted.signIn.mockImplementation(
			() =>
				new Promise((r) => {
					resolveSignIn = r;
				}),
		);
		const { container } = await mountReady();
		const form = container.querySelector("form");
		if (!form) throw new Error("form not found");
		// Two synchronous submits before any await — this is the race the
		// ref-lock must win.
		await act(async () => {
			fireEvent.submit(form);
			fireEvent.submit(form);
			await flush();
		});
		expect(hoisted.signIn).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveSignIn({ ok: true });
			await flush();
		});
	});

	it("failure path: button re-enables and exposes the error", async () => {
		hoisted.signIn.mockResolvedValue({ error: "CredentialsSignin" });
		const { container } = await mountReady();
		await act(async () => {
			submitForm(container);
			await flush();
		});
		const btn = getSubmitButton();
		expect(btn.disabled).toBe(false);
		expect(btn.textContent?.trim()).toBe("登录");
		// Error banner rendered (loginErrorMessage mock → "err:<raw>")
		expect(screen.getByRole("alert").textContent).toContain("err:CredentialsSignin");
	});

	it("exception path: button re-enables and shows network error", async () => {
		hoisted.signIn.mockRejectedValue(new Error("boom"));
		const { container } = await mountReady();
		await act(async () => {
			submitForm(container);
			await flush();
		});
		const btn = getSubmitButton();
		expect(btn.disabled).toBe(false);
		expect(btn.textContent?.trim()).toBe("登录");
		expect(screen.getByRole("alert").textContent).toContain("网络错误");
	});

	it("success path: button stays disabled during redirect window (no second signIn)", async () => {
		hoisted.signIn.mockResolvedValue({ ok: true });
		const { container } = await mountReady();
		await act(async () => {
			submitForm(container);
			await flush();
		});
		const btn = getSubmitButton();
		expect(btn.disabled).toBe(true);
		expect(btn.textContent).toContain("正在跳转");
		expect(assignedHref).toBe("/");
		// Attempt a second submit during the redirect window — must not call signIn again.
		await act(async () => {
			submitForm(container);
			await flush();
		});
		expect(hoisted.signIn).toHaveBeenCalledTimes(1);
	});
});
