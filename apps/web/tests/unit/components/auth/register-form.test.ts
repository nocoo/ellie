// @vitest-environment happy-dom
// Tests for RegisterFormCore — dialog & standalone variants
//
// CAP env is module-level (read at import time). We use dynamic imports
// + `vi.resetModules()` per test so each describe can control whether
// CAP is configured.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CAP_ENV = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT;

afterAll(() => {
	if (ORIGINAL_CAP_ENV === undefined) {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
	} else {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = ORIGINAL_CAP_ENV;
	}
});

// ─── Shared mocks ────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

const mockRegisterUser = vi.fn();
vi.mock("@/actions/auth", () => ({
	registerUser: (...args: unknown[]) => mockRegisterUser(...args),
}));

vi.mock("@/lib/forum-browser-api", () => ({
	checkUsernameAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

const mockSignIn = vi.fn();
vi.mock("next-auth/react", () => ({
	signIn: (...args: unknown[]) => mockSignIn(...args),
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

vi.mock("@/components/ui/select", () => ({
	Select: ({ options, ...props }: any) =>
		createElement(
			"select",
			{ ...props, "data-testid": props.id },
			options?.map((opt: any) =>
				createElement("option", { key: opt.value, value: opt.value }, opt.label),
			),
		),
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: any) => createElement("textarea", { ...props, "data-testid": props.id }),
}));

const inertCapMock = () => ({
	CapWidget: () => createElement("div", { "data-testid": "cap-widget" }),
});

const autoSolveCapMock = () => ({
	CapWidget: ({ onSolve }: { onSolve: (t: string) => void }) => {
		useEffect(() => {
			onSolve("test-token");
		}, [onSolve]);
		return createElement("div", { "data-testid": "cap-widget" });
	},
});

async function loadForm() {
	return await import("@/app/(auth)/register/register-form");
}

afterEach(cleanup);

// ─── Layout & field rendering — CAP enabled, inert widget ───────────────────

describe("RegisterForm (standalone) — layout", () => {
	beforeAll(() => {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
	});

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		vi.doMock("@/components/cap-widget", inertCapMock);
	});

	it("renders inside AuthIdCard", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByTestId("auth-id-card")).toBeTruthy();
	});

	it("renders account fields including birthday", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByPlaceholderText("2-15 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("至少 6 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("再次输入密码")).toBeTruthy();
		expect(screen.getByPlaceholderText("your@email.com")).toBeTruthy();
		expect(screen.getByPlaceholderText("年")).toBeTruthy();
		expect(screen.getByPlaceholderText("月")).toBeTruthy();
		expect(screen.getByPlaceholderText("日")).toBeTruthy();
	});

	it("renders profile fields collapsible section", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByText("教育信息")).toBeTruthy();
		expect(screen.getByText("个人信息（选填）")).toBeTruthy();
	});

	it("renders education Select fields", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByTestId("reg-identity")).toBeTruthy();
		expect(screen.getByTestId("reg-campus")).toBeTruthy();
	});

	it("renders personal input fields", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByTestId("reg-gender")).toBeTruthy();
		expect(screen.getByPlaceholderText("简单介绍自己")).toBeTruthy();
		expect(screen.getByPlaceholderText("一句话签名")).toBeTruthy();
	});

	it("renders posting conditions note", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		expect(screen.getByText("新用户须知")).toBeTruthy();
		expect(screen.getByText("注册后需完成邮箱验证方可发帖")).toBeTruthy();
	});

	it("submit button is disabled when education fields are empty", async () => {
		const { default: RegisterForm } = await loadForm();
		render(createElement(RegisterForm));
		const submitBtn = screen.getByText("创建账号");
		expect(submitBtn.closest("button")?.disabled).toBe(true);
	});
});

describe("RegisterFormDialog — layout", () => {
	beforeAll(() => {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
	});

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		vi.doMock("@/components/cap-widget", inertCapMock);
	});

	it("renders 3-column section headers", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText("账号信息")).toBeTruthy();
		expect(screen.getByText("教育信息")).toBeTruthy();
		expect(screen.getByText("个人信息（选填）")).toBeTruthy();
	});

	it("renders account fields in dialog", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByPlaceholderText("2-15 个字符")).toBeTruthy();
		expect(screen.getByPlaceholderText("your@email.com")).toBeTruthy();
		expect(screen.getByPlaceholderText("年")).toBeTruthy();
	});

	it("renders education Select fields in dialog", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByTestId("reg-identity")).toBeTruthy();
		expect(screen.getByTestId("reg-campus")).toBeTruthy();
	});

	it("renders identity type options", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText("校内人士")).toBeTruthy();
		expect(screen.getByText("已毕业校友")).toBeTruthy();
		expect(screen.getAllByText("校外人士").length).toBeGreaterThanOrEqual(1);
	});

	it("renders campus options", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText("四平路校区")).toBeTruthy();
		expect(screen.getByText("嘉定校区")).toBeTruthy();
		expect(screen.getByText("沪西校区")).toBeTruthy();
		expect(screen.getByText("沪北校区")).toBeTruthy();
		expect(screen.getByText("其他校区")).toBeTruthy();
	});

	it("renders personal fields in dialog", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByTestId("reg-gender")).toBeTruthy();
		expect(screen.getByPlaceholderText("爱好特长")).toBeTruthy();
		expect(screen.getByPlaceholderText("QQ 号码")).toBeTruthy();
		expect(screen.getByPlaceholderText("https://...")).toBeTruthy();
		expect(screen.getByPlaceholderText("一句话签名")).toBeTruthy();
	});

	it("renders posting conditions note", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText("新用户须知")).toBeTruthy();
	});

	it("does not render AuthIdCard wrapper", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.queryByTestId("auth-id-card")).toBeNull();
	});
});

// ─── onSuccess & payload — CAP enabled, auto-solve ──────────────────────────

describe("onSuccess behavior", () => {
	beforeAll(() => {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
	});

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		vi.doMock("@/components/cap-widget", autoSolveCapMock);
	});

	it("does not call onSuccess when signIn fails", async () => {
		const { RegisterFormDialog } = await loadForm();
		const onSuccess = vi.fn();
		mockRegisterUser.mockResolvedValue({ success: true });
		mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

		render(createElement(RegisterFormDialog, { onSuccess }));

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
		fireEvent.change(screen.getByTestId("reg-identity"), {
			target: { value: "校内人士" },
		});
		fireEvent.change(screen.getByTestId("reg-campus"), {
			target: { value: "四平路校区" },
		});

		fireEvent.click(screen.getByText("创建账号"));

		await vi.waitFor(() => {
			expect(mockRegisterUser).toHaveBeenCalled();
		});
		await vi.waitFor(() => {
			expect(mockSignIn).toHaveBeenCalled();
		});
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("calls onSuccess when signIn succeeds", async () => {
		const { RegisterFormDialog } = await loadForm();
		const onSuccess = vi.fn();
		mockRegisterUser.mockResolvedValue({ success: true });
		mockSignIn.mockResolvedValue({ ok: true });

		render(createElement(RegisterFormDialog, { onSuccess }));

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
		fireEvent.change(screen.getByTestId("reg-identity"), {
			target: { value: "已毕业校友" },
		});
		fireEvent.change(screen.getByTestId("reg-campus"), {
			target: { value: "嘉定校区" },
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

describe("Select values in registerUser payload", () => {
	beforeAll(() => {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
	});

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		vi.doMock("@/components/cap-widget", autoSolveCapMock);
	});

	it("submits graduateSchool and campus from Select fields", async () => {
		const { RegisterFormDialog } = await loadForm();
		mockRegisterUser.mockResolvedValue({ success: true });
		mockSignIn.mockResolvedValue({ ok: true });

		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));

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
		fireEvent.change(screen.getByTestId("reg-identity"), {
			target: { value: "已毕业校友" },
		});
		fireEvent.change(screen.getByTestId("reg-campus"), {
			target: { value: "嘉定校区" },
		});

		fireEvent.click(screen.getByText("创建账号"));

		await vi.waitFor(() => {
			expect(mockRegisterUser).toHaveBeenCalled();
		});

		const [, , , profile] = mockRegisterUser.mock.calls[0];
		expect(profile.graduateSchool).toBe("已毕业校友");
		expect(profile.campus).toBe("嘉定校区");
	});
});

// ─── Fail-closed when CAP is not configured ─────────────────────────────────

describe("CAPTCHA fail-closed when not configured", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
		vi.doMock("@/components/cap-widget", inertCapMock);
	});

	it("does not render CAP widget when env is empty", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.queryByTestId("cap-widget")).toBeNull();
	});

	it("renders fail-closed error banner when env is empty", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByText(/人机验证服务未就绪/)).toBeTruthy();
	});

	it("submit button is disabled when CAP is not configured (even with valid fields)", async () => {
		const { RegisterFormDialog } = await loadForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));

		// Fill every required field — submit should still be disabled.
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
		fireEvent.change(screen.getByTestId("reg-identity"), {
			target: { value: "校内人士" },
		});
		fireEvent.change(screen.getByTestId("reg-campus"), {
			target: { value: "四平路校区" },
		});

		const submitBtn = screen.getByText("创建账号");
		expect(submitBtn.closest("button")?.disabled).toBe(true);
	});
});
