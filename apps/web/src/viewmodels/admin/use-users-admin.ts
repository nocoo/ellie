// viewmodels/admin/use-users-admin.ts — ViewModel for Admin Users page
// MVVM Pattern: Encapsulates all user management state and logic.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
	type User,
	type UserUpdate,
	banUser,
	batchSetStatus,
	nukeUser,
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
 * Confirm dialog state
 */
export interface ConfirmDialogState {
	open: boolean;
	title: string;
	description: string;
	variant: "default" | "destructive";
	requireInput?: string;
	onConfirm: () => void;
}

/**
 * Filter values for user search
 */
export interface UserFilters {
	search: string;
	status: string;
	role: string;
	[key: string]: string; // Index signature for compatibility with AdminFilters
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
	/** Confirm dialog state */
	confirmDialog: ConfirmDialogState;
	/** Confirm dialog loading state */
	confirmLoading: boolean;
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
	/** Ban a user */
	handleBan: (user: User, deleteContent?: boolean) => void;
	/** Nuke a user (ban + delete all + reset credits) */
	handleNuke: (user: User) => void;
	/** Unban a user */
	handleUnban: (user: User) => Promise<void>;
	/** Handle batch action on selected users */
	handleBatchAction: (key: string) => Promise<void>;
	/** Update selected IDs */
	setSelectedIds: (ids: Set<string | number>) => void;
	/** Close confirm dialog */
	closeConfirmDialog: () => void;
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
}

// ---------------------------------------------------------------------------
// Default states
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: UserFilters = {
	search: "",
	status: "",
	role: "",
};

const DEFAULT_PAGINATION: PaginationInfo = {
	page: 1,
	pages: 0,
	total: 0,
	limit: 20,
};

const DEFAULT_CONFIRM_DIALOG: ConfirmDialogState = {
	open: false,
	title: "",
	description: "",
	variant: "default",
	onConfirm: () => {},
};

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Build URL search params from filters.
 * Pure function for testability.
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
			limit: json.meta?.limit ?? 20,
		},
	};
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
	const { initialPageSize = 20 } = options;

	// Data state
	const [data, setData] = useState<User[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		...DEFAULT_PAGINATION,
		limit: initialPageSize,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<UserFilters>(DEFAULT_FILTERS);
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Dialog states
	const [editUser, setEditUser] = useState<User | null>(null);
	const [editLoading, setEditLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(DEFAULT_CONFIRM_DIALOG);
	const [confirmLoading, setConfirmLoading] = useState(false);

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
	}, []);

	const closeEditDialog = useCallback(() => {
		setEditUser(null);
	}, []);

	const handleEditSave = useCallback(
		async (id: number, update: UserUpdate) => {
			setEditLoading(true);
			try {
				await updateUser(id, update);
				setEditUser(null);
				fetchData(pagination.page);
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	// -------------------------------------------------------------------------
	// Moderation handlers
	// -------------------------------------------------------------------------

	const handleBan = useCallback(
		(user: User, deleteContent = false) => {
			setConfirmDialog({
				open: true,
				title: deleteContent ? "封禁并删除内容" : "封禁用户",
				description: deleteContent
					? `封禁 ${user.username} 并删除其所有内容？此操作不可撤销。`
					: `确定封禁 ${user.username}？封禁后该用户将无法访问论坛。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await banUser(user.id, deleteContent);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleNuke = useCallback(
		(user: User) => {
			setConfirmDialog({
				open: true,
				title: "彻底清除用户",
				description: `此操作将封禁 ${user.username}，删除其所有内容，并将积分重置为 0。此操作不可撤销。`,
				variant: "destructive",
				requireInput: user.username,
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await nukeUser(user.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page],
	);

	const handleUnban = useCallback(
		async (user: User) => {
			await updateUser(user.id, { status: 0 });
			fetchData(pagination.page);
		},
		[fetchData, pagination.page],
	);

	const closeConfirmDialog = useCallback(() => {
		setConfirmDialog((d) => ({ ...d, open: false }));
	}, []);

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
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

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
			confirmDialog,
			confirmLoading,
		},
		actions: {
			fetchData,
			handlePageChange,
			handleFilterChange,
			handleClearFilters,
			openEditDialog,
			closeEditDialog,
			handleEditSave,
			handleBan,
			handleNuke,
			handleUnban,
			handleBatchAction,
			setSelectedIds,
			closeConfirmDialog,
		},
	};
}
