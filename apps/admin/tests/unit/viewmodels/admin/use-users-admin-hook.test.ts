// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the users module API functions
vi.mock("@/viewmodels/admin/users", () => ({
	banUser: vi.fn().mockResolvedValue({}),
	batchSetStatus: vi.fn().mockResolvedValue({}),
	nukeUser: vi.fn().mockResolvedValue({}),
	updateUser: vi.fn().mockResolvedValue({}),
}));

import { useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import type { User } from "@/viewmodels/admin/users";
import { banUser, batchSetStatus, nukeUser, updateUser } from "@/viewmodels/admin/users";

const mockBanUser = banUser as ReturnType<typeof vi.fn>;
const mockBatchSetStatus = batchSetStatus as ReturnType<typeof vi.fn>;
const mockNukeUser = nukeUser as ReturnType<typeof vi.fn>;
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
	avatarPath: "",
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

	it("handleBan opens confirm dialog", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleBan(MOCK_USER);
		});

		expect(result.current.state.confirmDialog.open).toBe(true);
		expect(result.current.state.confirmDialog.variant).toBe("destructive");
	});

	it("handleBan with deleteContent uses different title", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleBan(MOCK_USER, true);
		});

		expect(result.current.state.confirmDialog.title).toContain("删除内容");
	});

	it("handleBan confirm calls banUser", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleBan(MOCK_USER, false);
		});

		await act(async () => {
			await result.current.state.confirmDialog.onConfirm();
		});

		expect(mockBanUser).toHaveBeenCalledWith(1, false);
	});

	it("handleNuke opens confirm with requireInput", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleNuke(MOCK_USER);
		});

		expect(result.current.state.confirmDialog.open).toBe(true);
		expect(result.current.state.confirmDialog.requireInput).toBe("alice");
	});

	it("handleNuke confirm calls nukeUser", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleNuke(MOCK_USER);
		});

		await act(async () => {
			await result.current.state.confirmDialog.onConfirm();
		});

		expect(mockNukeUser).toHaveBeenCalledWith(1);
	});

	it("handleUnban calls updateUser with status 0", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		await act(async () => {
			await result.current.actions.handleUnban(MOCK_USER);
		});

		expect(mockUpdateUser).toHaveBeenCalledWith(1, { status: 0 });
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

	it("closeConfirmDialog closes the dialog", async () => {
		const { result } = renderHook(() => useUsersAdmin());

		await waitFor(
			() => {
				expect(result.current.state.loading).toBe(false);
			},
			{ interval: 5 },
		);

		act(() => {
			result.current.actions.handleBan(MOCK_USER);
		});
		expect(result.current.state.confirmDialog.open).toBe(true);

		act(() => {
			result.current.actions.closeConfirmDialog();
		});
		expect(result.current.state.confirmDialog.open).toBe(false);
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
