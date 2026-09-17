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

	it("keeps unsaved fields through avatar refresh and resets them when reopened", () => {
		const { result, rerender } = renderHook(
			({ open, initialData }) => useProfileEdit({ open, initialData }),
			{ wrapper, initialProps: { open: true, initialData: defaultData } },
		);
		act(() => result.current.actions.setField("bio", "Unsaved introduction"));
		const refreshed = { ...defaultData };
		rerender({ open: true, initialData: refreshed });
		expect(result.current.state.form.bio).toBe("Unsaved introduction");
		rerender({ open: false, initialData: refreshed });
		rerender({ open: true, initialData: refreshed });
		expect(result.current.state.form.bio).toBe(defaultData.bio);
	});

	it("sends one save while pending and allows a later save", async () => {
		let resolve!: (value: { data: object }) => void;
		mockPatch.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: true }), {
			wrapper,
		});
		act(() => result.current.actions.setField("bio", "First edit"));
		let pending!: Promise<void>;
		await act(async () => {
			pending = result.current.actions.handleSave();
			await result.current.actions.handleSave();
		});
		expect(mockPatch).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolve({ data: {} });
			await pending;
		});
		act(() => result.current.actions.setField("bio", "Second edit"));
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(mockPatch).toHaveBeenCalledTimes(2);
	});

	it("clearError clears error state", async () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: true }), {
			wrapper,
		});
		act(() => result.current.actions.setField("birthYear", 1800));
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
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: true }), {
			wrapper,
		});
		act(() => result.current.actions.setField("birthYear", 1800));
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
		act(() => result.current.actions.setField("bio", "Saved introduction"));
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
		act(() => result.current.actions.setField("bio", "Unsaved introduction"));
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
		act(() => result.current.actions.setField("bio", "Saved introduction"));
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
		act(() => result.current.actions.setField("bio", "Unsaved introduction"));
		await act(async () => {
			await result.current.actions.handleSave();
		});
		const alerts = screen.getAllByRole("alert");
		const errorToast = alerts.find((el) => el.textContent?.includes("Error: save"));
		expect(errorToast).toBeTruthy();
		expect(errorToast?.textContent).toContain("保存失败");
	});

	it("does not show toast on local birth date validation failure", async () => {
		const { result } = renderHook(() => useProfileEdit({ initialData: defaultData, open: true }), {
			wrapper,
		});
		act(() => result.current.actions.setField("birthYear", 1800));
		await act(async () => {
			await result.current.actions.handleSave();
		});
		expect(result.current.state.error).toContain("1900-2100");
		const alert = screen.queryByRole("alert");
		expect(alert).toBeNull();
	});

	it("closes an avatar-only edit without resubmitting an invalid legacy site", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(
			() =>
				useProfileEdit({
					initialData: { ...defaultData, site: "example.test" },
					open: true,
					onSuccess,
				}),
			{ wrapper },
		);
		await act(async () => result.current.actions.handleSave());
		expect(mockPatch).not.toHaveBeenCalled();
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(result.current.state.error).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("saves edits against the opening snapshot after an avatar refresh", async () => {
		const initial = { ...defaultData, site: "example.test" };
		const { result, rerender } = renderHook(
			({ initialData }) => useProfileEdit({ initialData, open: true }),
			{ wrapper, initialProps: { initialData: initial } },
		);
		act(() => result.current.actions.setField("bio", "My new introduction"));
		// A refresh can deliver other profile changes while this draft stays open.
		rerender({ initialData: { ...initial, signature: "Updated elsewhere" } });
		await act(async () => result.current.actions.handleSave());
		expect(mockPatch).toHaveBeenCalledExactlyOnceWith("/api/v1/users/me", {
			bio: "My new introduction",
		});
		await act(async () => result.current.actions.handleSave());
		expect(mockPatch).toHaveBeenCalledTimes(1);
	});
});
