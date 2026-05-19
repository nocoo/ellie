// @vitest-environment happy-dom
// Form-level regression for AuthHelpHint wiring in login & register forms.
//
// Helper-only tests pin AuthHelpHint behavior, but they don't catch a
// regression where the caller forgets to thread `visible={Boolean(capToken)}`
// or hard-codes `visible={true}`. These tests dynamically mock CapWidget in
// two flavors per form:
//   - "inert" CapWidget that never calls onSolve → hint must NOT render
//   - "auto-solve" CapWidget that calls onSolve("token") on mount →
//     hint MUST render
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
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
	vi.resetModules();
	process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
});

afterEach(cleanup);

// ─── Shared mocks ──────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/viewmodels/forum/auth", () => ({
	canSubmitLogin: () => false,
	loginErrorMessage: () => null,
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

vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("div", { "data-testid": "forum-logo" }),
}));

// Use the REAL AuthHelpHint — that's the point of this test: we want
// to verify the form wires its visible prop. AuthIdCard is replaced with
// a passthrough so we don't drag in the full chrome.
vi.mock("@/app/(auth)/_components/auth-id-card", async () => {
	const real = await vi.importActual<
		typeof import("../../../../src/app/(auth)/_components/auth-id-card")
	>("@/app/(auth)/_components/auth-id-card");
	return {
		AuthIdCard: ({ children }: any) =>
			createElement("div", { "data-testid": "auth-id-card" }, children),
		AuthDivider: () => createElement("hr"),
		AuthErrorBanner: ({ message }: any) => createElement("div", { role: "alert" }, message),
		AuthHelpHint: real.AuthHelpHint,
	};
});

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
	Dialog: ({ children }: any) => createElement("div", null, children),
	DialogTrigger: ({ render: renderProp }: any) => createElement("div", null, renderProp),
	DialogContent: ({ children }: any) => createElement("div", null, children),
	DialogHeader: ({ children }: any) => createElement("div", null, children),
	DialogTitle: ({ children }: any) => createElement("h2", null, children),
	DialogDescription: ({ children }: any) => createElement("p", null, children),
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

vi.mock("@/app/(auth)/register/register-form", async () => {
	// Provide a stub for the RegisterFormDialog import in LoginForm — we
	// don't render it in these tests but the symbol must exist.
	return {
		RegisterFormDialog: () => null,
		default: () => null,
	};
});

// ─── Inert CAP mock (default for "pre-solve" tests) ────────────────────────

const inertCapMock = () => ({
	CapWidget: () => createElement("div", { "data-testid": "cap-widget" }),
});

// ─── Auto-solve CAP mock (immediately calls onSolve on mount) ──────────────

const autoSolveCapMock = () => ({
	CapWidget: ({ onSolve }: { onSolve: (t: string) => void }) => {
		// Simulate Cap.js firing the solve callback after CAPTCHA passes.
		useEffect(() => {
			onSolve("test-token");
		}, [onSolve]);
		return createElement("div", { "data-testid": "cap-widget" });
	},
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("LoginForm AuthHelpHint wiring", () => {
	it("hint is hidden before CAPTCHA solve", async () => {
		vi.doMock("@/components/cap-widget", inertCapMock);
		const { default: LoginForm } = await import("@/app/(auth)/login/login-form");
		render(createElement(LoginForm));
		// CAP rendered, hint not yet.
		expect(screen.getByTestId("cap-widget")).toBeTruthy();
		expect(screen.queryByTestId("auth-help-hint")).toBeNull();
	});

	it("hint appears after CAPTCHA onSolve fires", async () => {
		vi.doMock("@/components/cap-widget", autoSolveCapMock);
		const { default: LoginForm } = await import("@/app/(auth)/login/login-form");
		render(createElement(LoginForm));
		await waitFor(() => {
			expect(screen.getByTestId("auth-help-hint")).toBeTruthy();
		});
	});
});

describe("RegisterForm (standalone) AuthHelpHint wiring", () => {
	it("hint is hidden before CAPTCHA solve", async () => {
		vi.doMock("@/components/cap-widget", inertCapMock);
		const mod = await import("@/app/(auth)/register/register-form");
		// dynamic import returns the actual module; we mocked it above so
		// reimport with importActual to get the real one
		const real = await vi.importActual<typeof mod>("@/app/(auth)/register/register-form");
		render(createElement(real.default));
		expect(screen.getByTestId("cap-widget")).toBeTruthy();
		expect(screen.queryByTestId("auth-help-hint")).toBeNull();
	});

	it("hint appears after CAPTCHA onSolve fires", async () => {
		vi.doMock("@/components/cap-widget", autoSolveCapMock);
		const mod = await import("@/app/(auth)/register/register-form");
		const real = await vi.importActual<typeof mod>("@/app/(auth)/register/register-form");
		render(createElement(real.default));
		await waitFor(() => {
			expect(screen.getByTestId("auth-help-hint")).toBeTruthy();
		});
	});
});
