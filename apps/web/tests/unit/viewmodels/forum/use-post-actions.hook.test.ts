// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
const mockRefresh = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

// Mock moderation API
const mockDeleteMyPost = vi.fn(async () => {});
const mockDeletePost = vi.fn(async () => {});
const mockEditMyPost = vi.fn(async () => {});
const mockEditPost = vi.fn(async () => {});
vi.mock("@/lib/moderation-api", () => ({
	deleteMyPost: (...args: any[]) => mockDeleteMyPost(...args),
	deletePost: (...args: any[]) => mockDeletePost(...args),
	editMyPost: (...args: any[]) => mockEditMyPost(...args),
	editPost: (...args: any[]) => mockEditPost(...args),
}));

vi.mock("@/lib/api-client", () => ({
	ApiError: class ApiError extends Error {
		message: string;
		constructor(m: string) {
			super(m);
			this.message = m;
		}
	},
}));

import { usePostActions } from "@/viewmodels/forum/use-post-actions";

describe("usePostActions hook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns initial state with all dialogs closed", () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 1, isOwnPost: true, canModerate: false }),
		);
		expect(result.current.state.editDialogOpen).toBe(false);
		expect(result.current.state.deleteDialogOpen).toBe(false);
		expect(result.current.state.deleting).toBe(false);
		expect(result.current.state.deleteError).toBeNull();
	});

	it("opens edit dialog", () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 1, isOwnPost: true, canModerate: false }),
		);
		act(() => {
			result.current.actions.handleEdit();
		});
		expect(result.current.state.editDialogOpen).toBe(true);
	});

	it("closes edit dialog", () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 1, isOwnPost: true, canModerate: false }),
		);
		act(() => {
			result.current.actions.handleEdit();
		});
		act(() => {
			result.current.actions.handleEditClose();
		});
		expect(result.current.state.editDialogOpen).toBe(false);
	});

	it("opens delete dialog and clears previous error", () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 1, isOwnPost: true, canModerate: false }),
		);
		act(() => {
			result.current.actions.handleDeleteClick();
		});
		expect(result.current.state.deleteDialogOpen).toBe(true);
		expect(result.current.state.deleteError).toBeNull();
	});

	it("closes delete dialog", () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 1, isOwnPost: true, canModerate: false }),
		);
		act(() => {
			result.current.actions.handleDeleteClick();
		});
		act(() => {
			result.current.actions.handleDeleteClose();
		});
		expect(result.current.state.deleteDialogOpen).toBe(false);
	});

	it("deletes own post successfully", async () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 42, isOwnPost: true, canModerate: false }),
		);
		await act(async () => {
			await result.current.actions.handleDeleteConfirm();
		});
		expect(mockDeleteMyPost).toHaveBeenCalledWith(42);
		expect(result.current.state.deleteDialogOpen).toBe(false);
		expect(mockRefresh).toHaveBeenCalled();
	});

	it("deletes post as moderator", async () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 42, isOwnPost: false, canModerate: true }),
		);
		await act(async () => {
			await result.current.actions.handleDeleteConfirm();
		});
		expect(mockDeletePost).toHaveBeenCalledWith(42);
	});

	it("shows error when no permission to delete", async () => {
		const { result } = renderHook(() =>
			usePostActions({ postId: 42, isOwnPost: false, canModerate: false }),
		);
		await act(async () => {
			await result.current.actions.handleDeleteConfirm();
		});
		expect(result.current.state.deleteError).toBe("删除失败");
	});

	it("calls onDeleteSuccess callback instead of router.refresh", async () => {
		const onSuccess = vi.fn();
		const { result } = renderHook(() =>
			usePostActions({
				postId: 42,
				isOwnPost: true,
				canModerate: false,
				onDeleteSuccess: onSuccess,
			}),
		);
		await act(async () => {
			await result.current.actions.handleDeleteConfirm();
		});
		expect(onSuccess).toHaveBeenCalled();
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it("handles API error during delete", async () => {
		mockDeleteMyPost.mockRejectedValueOnce(new Error("Network error"));
		const { result } = renderHook(() =>
			usePostActions({ postId: 42, isOwnPost: true, canModerate: false }),
		);
		await act(async () => {
			await result.current.actions.handleDeleteConfirm();
		});
		expect(result.current.state.deleteError).toBe("删除失败");
		expect(result.current.state.deleting).toBe(false);
	});
});
