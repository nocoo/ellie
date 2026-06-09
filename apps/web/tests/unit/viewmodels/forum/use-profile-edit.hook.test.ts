// @vitest-environment happy-dom
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

const mockPatch = vi.fn(async () => ({ data: {} }));
vi.mock("@/lib/api-client", () => ({
	apiClient: { patch: (...args: any[]) => mockPatch(...args) },
	ApiError: class ApiError extends Error {
		code?: string;
		constructor(m: string, c?: string) {
			super(m);
			this.code = c;
		}
	},
}));

vi.mock("@/lib/error-messages", () => ({
	getErrorMessage: vi.fn((_code: string | undefined, context: string) => `Error: ${context}`),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { useProfileEdit } from "@/viewmodels/forum/use-profile-edit";

function wrapper({ children }: { children: ReactNode }) {
	return createElement(ForumToastProvider, null, children);
}

const defaultData = {
	gender: 1,
	birthYear: 1990,
	birthMonth: 5,
	birthDay: 15,
	resideProvince: "北京",
	resideCity: "朝阳",
	graduateSchool: "PKU",
	campus: "燕园",
	bio: "hi",
	interest: "code",
	qq: "123",
	site: "https://x.com",
	signature: "—",
};

describe("useProfileEdit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	afterEach(() => {
		cleanup();
	});

	it("initializes form from initial data", () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		expect(result.current.state.form.gender).toBe(1);
		expect(result.current.state.form.bio).toBe("hi");
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
	});

	it("setField updates form", () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		act(() => {
			result.current.actions.setField("bio", "new bio");
		});
		expect(result.current.state.form.bio).toBe("new bio");
	});

	it("clearError clears error state", async () => {
		const { result } = renderHook(
			() => useProfileEdit({ initialData: { ...defaultData, birthYear: 1800 }, open: false }),
			{ wrapper },
		);
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).not.toBeNull();
		act(() => {
			result.current.actions.clearError();
		});
		expect(result.current.state.error).toBeNull();
	});

	it("resetForm resets to initial data", () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		act(() => {
			result.current.actions.setField("bio", "changed");
		});
		act(() => {
			result.current.actions.resetForm();
		});
		expect(result.current.state.form.bio).toBe("hi");
	});

	it("handleSave validates birth date and shows error", async () => {
		const { result } = renderHook(
			() => useProfileEdit({ initialData: { ...defaultData, birthYear: 1800 }, open: false }),
			{ wrapper },
		);
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toContain("1900-2100");
		expect(mockPatch).not.toHaveBeenCalled();
	});

	it("handleSave submits successfully and calls onSuccess", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(
			() => useProfileEdit({ initialData: defaultData, open: false, onSuccess }),
			{ wrapper },
		);
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(mockPatch).toHaveBeenCalledWith("/api/v1/users/me", expect.any(Object));
		expect(onSuccess).toHaveBeenCalled();
		expect(mockRefresh).toHaveBeenCalled();
	});

	it("handleSave handles API error", async () => {
		mockPatch.mockRejectedValueOnce(new Error("fail"));
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toBe("Error: save");
		expect(result.current.state.submitting).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Toast integration
	// -------------------------------------------------------------------------

	it("shows success toast on save", async () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		await act(async () => {
			await result.current.actions.handleSave();
		});
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("个人资料已保存");
	});

	it("shows error toast on API failure", async () => {
		mockPatch.mockRejectedValueOnce(new Error("fail"));
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }), {
			wrapper,
		});
		await act(async () => {
			await result.current.actions.handleSave();
		});
		const alerts = screen.getAllByRole("alert");
		const errorToast = alerts.find((el) => el.textContent?.includes("Error: save"));
		expect(errorToast).toBeTruthy();
		expect(errorToast?.textContent).toContain("保存失败");
	});

	it("does not show toast on local birth date validation failure", async () => {
		const { result } = renderHook(
			() => useProfileEdit({ initialData: { ...defaultData, birthYear: 1800 }, open: false }),
			{ wrapper },
		);
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toContain("1900-2100");
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
	});
});
