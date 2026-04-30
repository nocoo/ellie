// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useProfileEdit } from "@/viewmodels/forum/use-profile-edit";

const defaultData = {
	gender: 1,
	birthYear: 1990,
	birthMonth: 5,
	birthDay: 15,
	resideProvince: "北京",
	resideCity: "朝阳",
	graduateSchool: "PKU",
	bio: "hi",
	interest: "code",
	qq: "123",
	site: "https://x.com",
};

describe("useProfileEdit hook", () => {
	beforeEach(() => vi.clearAllMocks());

	it("initializes form from initial data", () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }));
		expect(result.current.state.form.gender).toBe(1);
		expect(result.current.state.form.bio).toBe("hi");
		expect(result.current.state.submitting).toBe(false);
		expect(result.current.state.error).toBeNull();
	});

	it("setField updates form", () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }));
		act(() => {
			result.current.actions.setField("bio", "new bio");
		});
		expect(result.current.state.form.bio).toBe("new bio");
	});

	it("clearError clears error state", async () => {
		const { result } = renderHook(() =>
			useProfileEdit({ initialData: { ...defaultData, birthYear: 1800 }, open: false }),
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
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }));
		act(() => {
			result.current.actions.setField("bio", "changed");
		});
		act(() => {
			result.current.actions.resetForm();
		});
		expect(result.current.state.form.bio).toBe("hi");
	});

	it("handleSave validates birth date and shows error", async () => {
		const { result } = renderHook(() =>
			useProfileEdit({ initialData: { ...defaultData, birthYear: 1800 }, open: false }),
		);
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toContain("1900-2100");
		expect(mockPatch).not.toHaveBeenCalled();
	});

	it("handleSave submits successfully and calls onSuccess", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(() =>
			useProfileEdit({ initialData: defaultData, open: false, onSuccess }),
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
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: false }));
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toBe("Error: save");
		expect(result.current.state.submitting).toBe(false);
	});
});
