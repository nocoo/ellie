// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the users module API functions used by the list-page hook.
// (Single-user destructive actions live on the detail page now and are
// tested separately; we only mock what this hook still imports.)
vi.mock("@/viewmodels/admin/users", () => ({
	batchSetStatus: vi.fn().mockResolvedValue({}),
	updateUser: vi.fn().mockResolvedValue({}),
}));

import { useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import type { User } from "@/viewmodels/admin/users";
import { batchSetStatus, updateUser } from "@/viewmodels/admin/users";

const mockBatchSetStatus = batchSetStatus as ReturnType<typeof vi.fn>;
const mockUpdateUser = updateUser as ReturnType<typeof vi.fn>;

const MOCK_USER: User = {
	id: 1,
	username: "alice",
	email: "alice@test.com",
	role: 0,
	status: 0,
	credits: 100,
	threads: 5,
	posts: 20,
	regDate: 1700000000,
	lastLogin: 1700001000,
	avatar: "",
};

function mockFetchSuccess(data: User[] = [MOCK_USER], meta = {}) {
	const response = {
		data,
		meta: { page: 1, pages: 1, total: data.length, limit: 20, ...meta },
	};
	global.fetch = vi.fn().mockResolvedValue({
		json: () => Promise.resolve(response),
	});
}

function mockFetchFailure() {
	global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFetchSuccess();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useUsersAdmin", () => {
	it("fetches data on mount", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		expect(result.current.state.data).toHaveLength(1);
		expect(result.current.state.data[0].username).toBe("alice");
		expect(result.current.state.pagination.total).toBe(1);
	});

	it("sets empty data on fetch failure", async () => {
		mockFetchFailure();
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		expect(result.current.state.data).toEqual([]);
	});

	it("handles page change", async () => {
		mockFetchSuccess([MOCK_USER], { page: 1, pages: 3 });
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		mockFetchSuccess([{ ...MOCK_USER, id: 2 }], { page: 2, pages: 3 });
		await act(async () => {
			await result.current.actions.fetchData(2);
		});

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		// Verify fetch was called with page=2
		const lastCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
		expect(lastCall).toContain("page=2");
	});

	it("handles filter change triggers re-fetch", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		await act(async () => {
			result.current.actions.handleFilterChange("search", "bob");
		});

		await waitFor(
			() => {
				expect(result.current.state.filters.search).toBe("bob");
			},
			{ interval: 5 },
		);
	});

	it("handleClearFilters resets filters", async () => {
		const { result } = renderHook(() => useUsersAdmin({ initialFilters: { search: "test" } }));

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		expect(result.current.state.filters.search).toBe("test");

		await act(async () => {
			result.current.actions.handleClearFilters();
		});

		expect(result.current.state.filters.search).toBe("");
	});

	it("openEditDialog / closeEditDialog", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.openEditDialog(MOCK_USER);
		});
		expect(result.current.state.editUser).toEqual(MOCK_USER);

		act(() => {
			result.current.actions.closeEditDialog();
		});
		expect(result.current.state.editUser).toBeNull();
	});

	it("handleEditSave calls updateUser and refetches", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.openEditDialog(MOCK_USER);
		});

		await act(async () => {
			await result.current.actions.handleEditSave(1, { role: 1 });
		});

		expect(mockUpdateUser).toHaveBeenCalledWith(1, { role: 1 });
		expect(result.current.state.editUser).toBeNull();
	});

	it("handleBatchAction ban calls batchSetStatus", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.setSelectedIds(new Set([1, 2]));
		});

		await act(async () => {
			await result.current.actions.handleBatchAction("ban");
		});

		expect(mockBatchSetStatus).toHaveBeenCalledWith([1, 2], -1);
		expect(result.current.state.selectedIds.size).toBe(0);
	});

	it("handleBatchAction activate calls batchSetStatus", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.setSelectedIds(new Set([3]));
		});

		await act(async () => {
			await result.current.actions.handleBatchAction("activate");
		});

		expect(mockBatchSetStatus).toHaveBeenCalledWith([3], 0);
	});

	it("handleBatchAction with empty selection does nothing", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		await act(async () => {
			await result.current.actions.handleBatchAction("ban");
		});

		expect(mockBatchSetStatus).not.toHaveBeenCalled();
	});

	it("initialPageSize option is respected", async () => {
		mockFetchSuccess();
		const { result } = renderHook(() => useUsersAdmin({ initialPageSize: 50 }));

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		// The fetch URL should contain limit=50
		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(fetchCall).toContain("limit=50");
	});
});
