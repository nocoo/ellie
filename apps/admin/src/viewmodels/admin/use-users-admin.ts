// viewmodels/admin/use-users-admin.ts — ViewModel for Admin Users page
// MVVM Pattern: Encapsulates all user management state and logic.
//
// Scope after D4-d:
//   The list page now exposes only 查看详情 + 编辑 in the per-row menu
//   plus 批量封禁 / 批量激活 in the batch bar. All single-user destructive
//   actions (ban / unban / purge) live on /admin/users/[id]; their state
//   and handlers are inlined in the detail page next to the destructive
//   UI. So this hook only owns: list fetch + filters + selection + edit
//   dialog + batch actions.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
	dateInputToUnixSecondsEnd,
	dateInputToUnixSecondsStart,
	normalizeNumRangeBound,
	rangeMaxKey,
	rangeMinKey,
} from "@/components/admin/admin-filters";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	batchSetStatus,
	purgeUser,
	type User,
	type UserUpdate,
	updateUser,
} from "@/viewmodels/admin/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Pagination info for data tables
 */
export interface PaginationInfo {
	page: number;
	pages: number;
	total: number;
	limit: number;
}

/**
 * Filter values for user search.
 *
 * Range filters (advanced filters section, Batch F of task #15) live under
 * the canonical `${key}Min` / `${key}Max` suffix keys produced by
 * `rangeMinKey` / `rangeMaxKey`. The keys are pre-declared here (instead
 * of relying on the index signature alone) so `DEFAULT_FILTERS` resets
 * them on 清除筛选 and so `Object.entries(filters)` enumerates them on
 * fresh state.
 *
 * UI semantics for date range fields: the value entered into the
 * `<input type="date">` is `YYYY-MM-DD` local-day; conversion to unix
 * seconds (00:00:00 / 23:59:59) is centralised in
 * `buildUserSearchParams` so the worker only ever sees integer seconds
 * with the `range` filter type registered in Batch E.
 */
export interface UserFilters {
	search: string;
	status: string;
	role: string;
	regIp: string;
	lastIp: string;
	// Advanced range filters (Batch F). Stored as raw input strings:
	// numranges hold numeric strings ("0", "100"); dateranges hold
	// `YYYY-MM-DD`. Empty string = unset.
	regDateMin: string;
	regDateMax: string;
	lastLoginMin: string;
	lastLoginMax: string;
	threadsMin: string;
	threadsMax: string;
	postsMin: string;
	postsMax: string;
	creditsMin: string;
	creditsMax: string;
	[key: string]: string; // Index signature for compatibility with AdminFilters
}

/**
 * Per-id outcome of a serial batch purge run. Failed entries carry the
 * extracted human message so the operator can see *why* — never silently
 * dropped (Batch G of task #15).
 */
export interface PurgeBatchOutcome {
	succeeded: number[];
	failed: { id: number; error: string }[];
}

/**
 * State returned by useUsersAdmin
 */
export interface UsersAdminState {
	/** User data array */
	data: User[];
	/** Pagination info */
	pagination: PaginationInfo;
	/** Loading state */
	loading: boolean;
	/** Filter values */
	filters: UserFilters;
	/** Selected user IDs */
	selectedIds: Set<string | number>;
	/** User being edited (null if none) */
	editUser: User | null;
	/** Edit dialog loading state */
	editLoading: boolean;
	/** Edit dialog inline error message (null if none) */
	editError: string | null;
	/** Batch purge confirm dialog open */
	purgeBatchOpen: boolean;
	/** Batch purge in-progress flag — disables confirm button + dialog close */
	purgeBatchLoading: boolean;
	/**
	 * Inline error shown inside the batch purge dialog (for setup-time
	 * issues, e.g. empty selection on confirm). Per-id failures are
	 * surfaced through `purgeBatchSummary` after the run completes.
	 */
	purgeBatchError: string | null;
	/** Last completed batch outcome — null until the first run resolves. */
	purgeBatchSummary: PurgeBatchOutcome | null;
	/**
	 * Currently-open user detail dialog target. `null` = dialog closed.
	 * The list page reads this to drive `<UserDetailDialog>` open/close
	 * without disturbing pagination/filter/selection (task #9 Phase C).
	 */
	detailUserId: number | null;
}

/**
 * Actions returned by useUsersAdmin
 */
export interface UsersAdminActions {
	/** Fetch data for a specific page */
	fetchData: (page?: number) => Promise<void>;
	/** Handle page change */
	handlePageChange: (page: number) => void;
	/** Handle filter change */
	handleFilterChange: (key: string, value: string) => void;
	/** Clear all filters */
	handleClearFilters: () => void;
	/** Open edit dialog for a user */
	openEditDialog: (user: User) => void;
	/** Close edit dialog */
	closeEditDialog: () => void;
	/** Save user edits */
	handleEditSave: (id: number, update: UserUpdate) => Promise<void>;
	/** Handle batch action on selected users */
	handleBatchAction: (key: string) => Promise<void>;
	/** Update selected IDs */
	setSelectedIds: (ids: Set<string | number>) => void;
	/** Close the batch purge dialog (also clears its inline error). */
	closePurgeBatchDialog: () => void;
	/** Dismiss the post-run summary banner. */
	clearPurgeBatchSummary: () => void;
	/**
	 * Confirm-handler for the batch purge dialog. Iterates the current
	 * selection serially (no concurrency, mirrors per-user purge flow on
	 * the detail page), records per-id success/failure, refreshes the
	 * list and clears the selection only when at least one purge ran.
	 */
	handlePurgeBatchConfirm: () => Promise<void>;
	/**
	 * Open the user-detail dialog for a single user (task #9 Phase C).
	 * Does NOT touch filters / pagination / selection — purely UI state.
	 */
	openDetail: (userId: number) => void;
	/** Close the detail dialog without touching other state. */
	closeDetail: () => void;
	/**
	 * Re-fetch the current page using the current filters and limit.
	 * Used by `<UserDetailDialog onChanged>` to refresh row data after
	 * an in-dialog mutation (edit / ban / unban / purge) so the table
	 * doesn't show stale status badges once the dialog closes. Selection
	 * is intentionally left alone — even if a purged id is still in
	 * `selectedIds`, subsequent batch actions ignore non-existent ids
	 * server-side, and forcibly clearing here would surprise operators
	 * who explicitly selected for follow-up.
	 */
	reloadCurrentPage: () => Promise<void>;
}

/**
 * Combined return type for useUsersAdmin
 */
export interface UseUsersAdminReturn {
	state: UsersAdminState;
	actions: UsersAdminActions;
}

/**
 * Options for useUsersAdmin hook
 */
export interface UseUsersAdminOptions {
	/** Initial page size (default: 20) */
	initialPageSize?: number;
	/** Initial filter values (default: all empty) */
	initialFilters?: Partial<UserFilters>;
}

// ---------------------------------------------------------------------------
// Default states
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: UserFilters = {
	search: "",
	status: "",
	role: "",
	regIp: "",
	lastIp: "",
	regDateMin: "",
	regDateMax: "",
	lastLoginMin: "",
	lastLoginMax: "",
	threadsMin: "",
	threadsMax: "",
	postsMin: "",
	postsMax: "",
	creditsMin: "",
	creditsMax: "",
};

const DEFAULT_PAGINATION: PaginationInfo = {
	page: 1,
	pages: 0,
	total: 0,
	limit: 100,
};

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Build URL search params from filters.
 * Pure function for testability.
 *
 * Range filter param naming aligns with worker `userConfig.filters`
 * registered in Batch E (regDate/lastLogin/threads/posts/credits).
 * Date inputs convert to inclusive unix-seconds bounds (Batch B
 * helpers); numeric inputs go through `normalizeNumRangeBound` so `0`
 * survives as a real bound. Invalid / empty values are omitted.
 */
export function buildUserSearchParams(
	page: number,
	limit: number,
	filters: UserFilters,
): URLSearchParams {
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("limit", String(limit));
	if (filters.search) params.set("username", filters.search);
	if (filters.status) params.set("status", filters.status);
	if (filters.role) params.set("role", filters.role);
	if (filters.regIp) params.set("regIp", filters.regIp);
	if (filters.lastIp) params.set("lastIp", filters.lastIp);

	// --- Advanced range filters (Batch F) ---
	// Date range → unix seconds (start = 00:00:00, end = 23:59:59 of the
	// local day). Worker `range` filter is inclusive on both sides.
	const regDateMin = dateInputToUnixSecondsStart(filters.regDateMin);
	if (regDateMin !== null) params.set(rangeMinKey("regDate"), String(regDateMin));
	const regDateMax = dateInputToUnixSecondsEnd(filters.regDateMax);
	if (regDateMax !== null) params.set(rangeMaxKey("regDate"), String(regDateMax));

	const lastLoginMin = dateInputToUnixSecondsStart(filters.lastLoginMin);
	if (lastLoginMin !== null) params.set(rangeMinKey("lastLogin"), String(lastLoginMin));
	const lastLoginMax = dateInputToUnixSecondsEnd(filters.lastLoginMax);
	if (lastLoginMax !== null) params.set(rangeMaxKey("lastLogin"), String(lastLoginMax));

	// Numeric ranges. `normalizeNumRangeBound` keeps "0" as a valid bound
	// (Number.isFinite, not truthy) so a user can filter "credits = 0".
	const numRanges: Array<[keyof UserFilters & string, keyof UserFilters & string, string]> = [
		["threadsMin", "threadsMax", "threads"],
		["postsMin", "postsMax", "posts"],
		["creditsMin", "creditsMax", "credits"],
	];
	for (const [minField, maxField, paramBase] of numRanges) {
		const min = normalizeNumRangeBound(filters[minField] ?? "");
		if (min !== null) params.set(rangeMinKey(paramBase), min);
		const max = normalizeNumRangeBound(filters[maxField] ?? "");
		if (max !== null) params.set(rangeMaxKey(paramBase), max);
	}

	return params;
}

/**
 * Parse API response to extract data and pagination.
 * Pure function for testability.
 */
export function parseUsersResponse(
	json: { data?: User[]; meta?: Partial<PaginationInfo> },
	fallbackPage: number,
): { data: User[]; pagination: PaginationInfo } {
	return {
		data: json.data ?? [],
		pagination: {
			page: json.meta?.page ?? fallbackPage,
			pages: json.meta?.pages ?? 0,
			total: json.meta?.total ?? 0,
			limit: json.meta?.limit ?? 100,
		},
	};
}

/**
 * Run a batch purge serially (Batch G of task #15).
 *
 * Reviewer constraint: do NOT introduce a worker batch endpoint; the
 * existing single-user purge handler is the source of truth (covers
 * staff guard, tombstone, R2). The UI loops one id at a time and
 * collects per-id outcomes so neither success nor failure is silently
 * dropped.
 *
 * Pure function — no React/state coupling — so it can be tested
 * standalone with a stubbed `purgeFn`.
 *
 * @param ids     Selected user ids in iteration order.
 * @param purgeFn Per-id mutation; must throw on failure.
 */
export async function runPurgeBatchSerial(
	ids: number[],
	purgeFn: (id: number) => Promise<unknown>,
): Promise<PurgeBatchOutcome> {
	const succeeded: number[] = [];
	const failed: { id: number; error: string }[] = [];
	for (const id of ids) {
		try {
			await purgeFn(id);
			succeeded.push(id);
		} catch (err) {
			failed.push({ id, error: extractErrorMessage(err, "彻底清除失败") });
		}
	}
	return { succeeded, failed };
}

/**
 * Build a human-readable banner string from a `PurgeBatchOutcome`.
 * Always reports both counts; appends up to 3 failed-id details so
 * the operator sees concrete reasons without overflowing the banner.
 * Returns `null` for an empty outcome (caller suppresses banner).
 */
export function formatPurgeBatchSummary(outcome: PurgeBatchOutcome): string | null {
	const { succeeded, failed } = outcome;
	if (succeeded.length === 0 && failed.length === 0) return null;
	const head = `批量清除完成：成功 ${succeeded.length}，失败 ${failed.length}`;
	if (failed.length === 0) return head;
	const sample = failed
		.slice(0, 3)
		.map((f) => `#${f.id}: ${f.error}`)
		.join("；");
	const more = failed.length > 3 ? ` 等 ${failed.length} 项` : "";
	return `${head}（${sample}${more}）`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * ViewModel hook for Admin Users page.
 * Encapsulates all data fetching, state management, and user actions.
 *
 * @example
 * ```tsx
 * const { state, actions } = useUsersAdmin();
 *
 * return (
 *   <AdminDataTable
 *     data={state.data}
 *     loading={state.loading}
 *     onSelectionChange={actions.setSelectedIds}
 *   />
 * );
 * ```
 */
export function useUsersAdmin(options: UseUsersAdminOptions = {}): UseUsersAdminReturn {
	const { initialPageSize = 20, initialFilters } = options;

	// Data state
	const [data, setData] = useState<User[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		...DEFAULT_PAGINATION,
		limit: initialPageSize,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<UserFilters>(() => {
		// Merge initial filters, filtering out undefined values
		if (!initialFilters) return DEFAULT_FILTERS;
		const merged = { ...DEFAULT_FILTERS };
		for (const [key, value] of Object.entries(initialFilters)) {
			if (value !== undefined) {
				merged[key] = value;
			}
		}
		return merged;
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Edit dialog state
	const [editUser, setEditUser] = useState<User | null>(null);
	const [editLoading, setEditLoading] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);

	// Batch purge dialog state (Batch G).
	const [purgeBatchOpen, setPurgeBatchOpen] = useState(false);
	const [purgeBatchLoading, setPurgeBatchLoading] = useState(false);
	const [purgeBatchError, setPurgeBatchError] = useState<string | null>(null);
	const [purgeBatchSummary, setPurgeBatchSummary] = useState<PurgeBatchOutcome | null>(null);

	// Detail dialog state (task #9 Phase C). Lives next to filters/
	// selection so closing the dialog never resets either.
	const [detailUserId, setDetailUserId] = useState<number | null>(null);

	// -------------------------------------------------------------------------
	// Data fetching
	// -------------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = buildUserSearchParams(page, pagination.limit, filters);
				const res = await fetch(`/api/admin/users?${params.toString()}`);
				const json = await res.json();
				const { data: userData, pagination: paginationData } = parseUsersResponse(json, page);
				setData(userData);
				setPagination(paginationData);
			} catch {
				setData([]);
			} finally {
				setLoading(false);
			}
		},
		[filters, pagination.limit],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	// -------------------------------------------------------------------------
	// Filter handlers
	// -------------------------------------------------------------------------

	const handlePageChange = useCallback(
		(page: number) => {
			fetchData(page);
		},
		[fetchData],
	);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters(DEFAULT_FILTERS);
	}, []);

	// -------------------------------------------------------------------------
	// Edit handlers
	// -------------------------------------------------------------------------

	const openEditDialog = useCallback((user: User) => {
		setEditUser(user);
		setEditError(null);
	}, []);

	const closeEditDialog = useCallback(() => {
		setEditUser(null);
		setEditError(null);
	}, []);

	const handleEditSave = useCallback(
		async (id: number, update: UserUpdate) => {
			setEditLoading(true);
			setEditError(null);
			try {
				await updateUser(id, update);
				setEditUser(null);
				fetchData(pagination.page);
			} catch (err) {
				setEditError(extractErrorMessage(err, "保存用户失败"));
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	// -------------------------------------------------------------------------
	// Batch handlers
	// -------------------------------------------------------------------------

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;

			if (key === "ban") {
				await batchSetStatus(ids, -1);
			} else if (key === "activate") {
				await batchSetStatus(ids, 0);
			} else if (key === "purge") {
				// Defer the actual purges until the operator types `ok` in
				// the confirm dialog. The dialog reads selectedIds at
				// confirm-time so any selection change between open + click
				// is honoured.
				setPurgeBatchError(null);
				setPurgeBatchSummary(null);
				setPurgeBatchOpen(true);
				return;
			} else {
				return;
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	const closePurgeBatchDialog = useCallback(() => {
		if (purgeBatchLoading) return;
		setPurgeBatchOpen(false);
		setPurgeBatchError(null);
	}, [purgeBatchLoading]);

	const clearPurgeBatchSummary = useCallback(() => {
		setPurgeBatchSummary(null);
	}, []);

	const handlePurgeBatchConfirm = useCallback(async () => {
		const ids = Array.from(selectedIds).map(Number);
		if (ids.length === 0) {
			setPurgeBatchError("未选择任何用户");
			return;
		}
		setPurgeBatchLoading(true);
		setPurgeBatchError(null);
		try {
			const outcome = await runPurgeBatchSerial(ids, purgeUser);
			setPurgeBatchSummary(outcome);
			setPurgeBatchOpen(false);
			// Always reload + clear selection — even if every id failed,
			// because the page may have transient state (status badges)
			// out of sync with reality.
			setSelectedIds(new Set());
			fetchData(pagination.page);
		} finally {
			setPurgeBatchLoading(false);
		}
	}, [selectedIds, fetchData, pagination.page]);

	// -------------------------------------------------------------------------
	// Detail dialog (Phase C of task #9)
	// -------------------------------------------------------------------------

	const openDetail = useCallback((id: number) => {
		setDetailUserId(id);
	}, []);

	const closeDetail = useCallback(() => {
		setDetailUserId(null);
	}, []);

	const reloadCurrentPage = useCallback(async () => {
		await fetchData(pagination.page);
	}, [fetchData, pagination.page]);

	// -------------------------------------------------------------------------
	// Return
	// -------------------------------------------------------------------------

	return {
		state: {
			data,
			pagination,
			loading,
			filters,
			selectedIds,
			editUser,
			editLoading,
			editError,
			purgeBatchOpen,
			purgeBatchLoading,
			purgeBatchError,
			purgeBatchSummary,
			detailUserId,
		},
		actions: {
			fetchData,
			handlePageChange,
			handleFilterChange,
			handleClearFilters,
			openEditDialog,
			closeEditDialog,
			handleEditSave,
			handleBatchAction,
			setSelectedIds,
			closePurgeBatchDialog,
			clearPurgeBatchSummary,
			handlePurgeBatchConfirm,
			openDetail,
			closeDetail,
			reloadCurrentPage,
		},
	};
}
