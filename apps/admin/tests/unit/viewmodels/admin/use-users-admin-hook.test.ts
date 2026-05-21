// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the users module API functions used by the list-page hook.
// (Single-user destructive actions live on the detail page now and are
// tested separately; we only mock what this hook still imports.)
vi.mock("@/viewmodels/admin/users", () => ({
	batchSetStatus: vi.fn().mockResolvedValue({}),
	updateUser: vi.fn().mockResolvedValue({}),
	purgeUser: vi.fn().mockResolvedValue({}),
}));

import { useUsersAdmin } from "@/viewmodels/admin/use-users-admin";
import type { User } from "@/viewmodels/admin/users";
import { batchSetStatus, purgeUser, updateUser } from "@/viewmodels/admin/users";

const mockBatchSetStatus = batchSetStatus as ReturnType<typeof vi.fn>;
const mockUpdateUser = updateUser as ReturnType<typeof vi.fn>;
const mockPurgeUser = purgeUser as ReturnType<typeof vi.fn>;

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

	// ----------------------------------------------------------------------
	// Batch G — batch purge dialog + serial loop
	// ----------------------------------------------------------------------

	describe("batch purge", () => {
		it("opens the confirm dialog and does NOT call purgeUser yet", async () => {
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			act(() => {
				result.current.actions.setSelectedIds(new Set([1, 2]));
			});
			await act(async () => {
				await result.current.actions.handleBatchAction("purge");
			});

			expect(result.current.state.purgeBatchOpen).toBe(true);
			expect(result.current.state.purgeBatchSummary).toBeNull();
			expect(mockPurgeUser).not.toHaveBeenCalled();
		});

		it("rejects confirm with empty selection", async () => {
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			await act(async () => {
				await result.current.actions.handlePurgeBatchConfirm();
			});

			expect(mockPurgeUser).not.toHaveBeenCalled();
			expect(result.current.state.purgeBatchError).toBe("未选择任何用户");
		});

		it("purges selected ids serially, surfaces summary, clears selection", async () => {
			mockPurgeUser.mockResolvedValue({});
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			act(() => {
				result.current.actions.setSelectedIds(new Set([10, 20]));
			});
			await act(async () => {
				await result.current.actions.handleBatchAction("purge");
			});
			await act(async () => {
				await result.current.actions.handlePurgeBatchConfirm();
			});

			expect(mockPurgeUser).toHaveBeenCalledTimes(2);
			expect(mockPurgeUser).toHaveBeenNthCalledWith(1, 10);
			expect(mockPurgeUser).toHaveBeenNthCalledWith(2, 20);
			expect(result.current.state.purgeBatchSummary).toEqual({
				succeeded: [10, 20],
				failed: [],
			});
			expect(result.current.state.purgeBatchOpen).toBe(false);
			expect(result.current.state.selectedIds.size).toBe(0);
		});

		it("captures per-id failures into summary (no silent drop)", async () => {
			mockPurgeUser.mockImplementation(async (id: number) => {
				if (id === 2) throw new Error("nope");
			});
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			act(() => {
				result.current.actions.setSelectedIds(new Set([1, 2, 3]));
			});
			await act(async () => {
				await result.current.actions.handleBatchAction("purge");
			});
			await act(async () => {
				await result.current.actions.handlePurgeBatchConfirm();
			});

			const summary = result.current.state.purgeBatchSummary;
			expect(summary?.succeeded).toEqual([1, 3]);
			expect(summary?.failed).toEqual([{ id: 2, error: "nope" }]);
		});

		it("closePurgeBatchDialog clears state but is no-op while loading", async () => {
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			act(() => {
				result.current.actions.setSelectedIds(new Set([1]));
			});
			await act(async () => {
				await result.current.actions.handleBatchAction("purge");
			});
			expect(result.current.state.purgeBatchOpen).toBe(true);

			act(() => {
				result.current.actions.closePurgeBatchDialog();
			});
			expect(result.current.state.purgeBatchOpen).toBe(false);
		});

		it("clearPurgeBatchSummary dismisses the banner", async () => {
			mockPurgeUser.mockResolvedValue({});
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			act(() => {
				result.current.actions.setSelectedIds(new Set([1]));
			});
			await act(async () => {
				await result.current.actions.handleBatchAction("purge");
			});
			await act(async () => {
				await result.current.actions.handlePurgeBatchConfirm();
			});
			expect(result.current.state.purgeBatchSummary).not.toBeNull();

			act(() => {
				result.current.actions.clearPurgeBatchSummary();
			});
			expect(result.current.state.purgeBatchSummary).toBeNull();
		});
	});

	// ----------------------------------------------------------------------
	// Batch F — handleClearFilters resets advanced range keys too
	// ----------------------------------------------------------------------

	// ----------------------------------------------------------------------
	// IP search filters (#9 Phase A) — pin that `regIp` / `lastIp` reach
	// the worker as exact-match query params, not just the viewmodel
	// state. The list page exposes these as `type: "search"` inputs in
	// the 高级过滤器 panel; this hook test guards the wire format.
	// ----------------------------------------------------------------------

	describe("IP filters", () => {
		it("regIp / lastIp survive into the fetch URL when set", async () => {
			const { result } = renderHook(() =>
				useUsersAdmin({
					initialFilters: { regIp: "1.2.3.4", lastIp: "::1" },
				}),
			);
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
			expect(fetchCall).toContain("regIp=1.2.3.4");
			// `::1` (IPv6 loopback) must URL-encode the colons; URLSearchParams
			// re-emits them as `%3A` so the worker side reads the original
			// value back intact.
			expect(fetchCall).toContain("lastIp=%3A%3A1");
		});

		it("handleFilterChange('regIp', ...) updates state and triggers a re-fetch", async () => {
			const { result } = renderHook(() => useUsersAdmin());
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			(global.fetch as ReturnType<typeof vi.fn>).mockClear();

			await act(async () => {
				result.current.actions.handleFilterChange("regIp", "10.0.0.1");
			});

			await waitFor(() => expect(result.current.state.filters.regIp).toBe("10.0.0.1"), {
				interval: 5,
			});

			const lastCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
			expect(lastCall).toContain("regIp=10.0.0.1");
		});

		it("clearing regIp via empty-string filter change drops it from the URL", async () => {
			const { result } = renderHook(() => useUsersAdmin({ initialFilters: { regIp: "1.2.3.4" } }));
			await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

			await act(async () => {
				result.current.actions.handleFilterChange("regIp", "");
			});

			await waitFor(() => expect(result.current.state.filters.regIp).toBe(""), { interval: 5 });

			const lastCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
			expect(lastCall).not.toContain("regIp=");
		});
	});

	it("handleClearFilters resets basic + advanced range keys", async () => {
		const { result } = renderHook(() =>
			useUsersAdmin({
				initialFilters: { search: "alice" },
			}),
		);
		await waitFor(() => expect(result.current.state.loading).toBe(false), { interval: 5 });

		act(() => {
			result.current.actions.handleFilterChange("regDateMin", "2026-01-01");
			result.current.actions.handleFilterChange("threadsMax", "100");
			result.current.actions.handleFilterChange("creditsMin", "0");
		});
		expect(result.current.state.filters.regDateMin).toBe("2026-01-01");
		expect(result.current.state.filters.threadsMax).toBe("100");
		expect(result.current.state.filters.creditsMin).toBe("0");

		act(() => {
			result.current.actions.handleClearFilters();
		});
		expect(result.current.state.filters.search).toBe("");
		expect(result.current.state.filters.regDateMin).toBe("");
		expect(result.current.state.filters.threadsMax).toBe("");
		expect(result.current.state.filters.creditsMin).toBe("");
	});
});
