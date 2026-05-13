// @vitest-environment happy-dom
// Tests for register form CAPTCHA layout when CAP is enabled.
// Separate file because CAP_API_ENDPOINT is a module-level constant —
// must set the env AND reset the module cache before each test, since
// the web vitest config runs with `isolate: false` (shared worker +
// module cache across files). Without `vi.resetModules()` the
// register-form module evaluated by another test file would survive
// with CAP disabled and our `getByTestId("cap-widget")` assertions
// would silently fail.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CAP_ENV = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT;

beforeAll(() => {
	process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
});

afterAll(() => {
	if (ORIGINAL_CAP_ENV === undefined) {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
	} else {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = ORIGINAL_CAP_ENV;
	}
});

beforeEach(() => {
	// Force re-evaluation of the register-form module so the
	// module-level `CAP_API_ENDPOINT` constant picks up our env.
	vi.resetModules();
	process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
});

// ─── Mocks (same as register-form.test.ts) ──────────────────────────────────

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/actions/auth", () => ({
	registerUser: vi.fn(),
}));

vi.mock("@/lib/forum-browser-api", () => ({
	checkUsernameAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock("next-auth/react", () => ({
	signIn: vi.fn(),
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

// Static import is intentionally avoided — see beforeEach. Use
// `loadRegisterForm()` inside each test to dynamically import after the
// module cache has been reset.
async function loadRegisterForm() {
	return await import("@/app/(auth)/register/register-form");
}

afterEach(cleanup);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CAPTCHA layout when CAP is enabled", () => {
	it("renders CAP widget in dialog variant", async () => {
		const { RegisterFormDialog } = await loadRegisterForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));
		expect(screen.getByTestId("cap-widget")).toBeTruthy();
	});

	it("renders CAP widget in standalone variant", async () => {
		const { default: RegisterForm } = await loadRegisterForm();
		render(createElement(RegisterForm));
		expect(screen.getByTestId("cap-widget")).toBeTruthy();
	});

	it("CAP widget and submit button share a parent container (dialog)", async () => {
		const { RegisterFormDialog } = await loadRegisterForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));

		const capWidget = screen.getByTestId("cap-widget");
		const submitBtn = screen.getByText("创建账号");

		// CAP is inside a flex container; that container and submit button share a parent
		const capContainer = capWidget.parentElement; // 58px flex div
		const submitButton = submitBtn.closest("button");
		expect(capContainer?.parentElement).toBe(submitButton?.parentElement);
	});

	it("CAP widget appears before submit button in DOM order (standalone)", async () => {
		const { default: RegisterForm } = await loadRegisterForm();
		render(createElement(RegisterForm));

		const capWidget = screen.getByTestId("cap-widget");
		const submitBtn = screen.getByText("创建账号");

		// compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4
		const position = capWidget.compareDocumentPosition(submitBtn);
		expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("PostingConditionsNote appears before CAPTCHA in DOM order (dialog)", async () => {
		const { RegisterFormDialog } = await loadRegisterForm();
		render(createElement(RegisterFormDialog, { onSuccess: vi.fn() }));

		const note = screen.getByText("新用户须知");
		const capWidget = screen.getByTestId("cap-widget");

		// PostingConditionsNote should come before CAPTCHA in DOM
		const position = note.compareDocumentPosition(capWidget);
		expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
