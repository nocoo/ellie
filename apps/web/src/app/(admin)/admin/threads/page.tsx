"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { ThreadEditDialog } from "@/components/admin/thread-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type Thread,
	type ThreadUpdate,
	batchDeleteThreads,
	deleteThread,
	digestLabel,
	stickyLabel,
	updateThread,
} from "@/viewmodels/admin/threads";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{ key: "search", label: "Search threads...", type: "search" },
	{
		key: "sticky",
		label: "Sticky",
		type: "select",
		options: [
			{ value: "1", label: "Forum Sticky" },
			{ value: "2", label: "Global Sticky" },
			{ value: "3", label: "Super Sticky" },
		],
	},
	{
		key: "closed",
		label: "Closed",
		type: "select",
		options: [
			{ value: "0", label: "Open" },
			{ value: "1", label: "Closed" },
		],
	},
];

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "delete", label: "Delete Selected", variant: "destructive" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ThreadsPage() {
	const [data, setData] = useState<Thread[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
		sticky: "",
		closed: "",
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	const [editThread, setEditThread] = useState<Thread | null>(null);
	const [editLoading, setEditLoading] = useState(false);
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.search) params.set("subject", filters.search);
				if (filters.sticky) params.set("sticky", filters.sticky);
				if (filters.closed) params.set("closed", filters.closed);

				const res = await fetch(`/api/admin/threads?${params.toString()}`);
				const json = await res.json();
				setData(json.data ?? []);
				setPagination({
					page: json.meta?.page ?? page,
					pages: json.meta?.pages ?? 0,
					total: json.meta?.total ?? 0,
					limit: json.meta?.limit ?? 20,
				});
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

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "", sticky: "", closed: "" });
	}, []);

	const handleEditSave = useCallback(
		async (id: number, update: ThreadUpdate) => {
			setEditLoading(true);
			try {
				await updateThread(id, update);
				setEditThread(null);
				fetchData(pagination.page);
			} finally {
				setEditLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	const handleDelete = useCallback(
		(thread: Thread) => {
			setConfirmDialog({
				open: true,
				title: "Delete Thread",
				description: `Delete "${thread.subject}" and all its replies? This cannot be undone.`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deleteThread(thread.id);
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

	const handleToggleClose = useCallback(
		async (thread: Thread) => {
			await updateThread(thread.id, { closed: thread.closed ? 0 : 1 });
			fetchData(pagination.page);
		},
		[fetchData, pagination.page],
	);

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;
			if (key === "delete") {
				await batchDeleteThreads(ids);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	const columns: ColumnDef<Thread>[] = [
		{
			key: "subject",
			header: "Subject",
			cell: (row) => <span className="font-medium">{row.subject}</span>,
		},
		{ key: "author", header: "Author", cell: (row) => row.authorName },
		{
			key: "replies",
			header: "Replies",
			cell: (row) => row.replies.toLocaleString(),
			className: "text-right",
		},
		{
			key: "views",
			header: "Views",
			cell: (row) => row.views.toLocaleString(),
			className: "text-right",
		},
		{
			key: "status",
			header: "Status",
			cell: (row) => (
				<div className="flex gap-1">
					{row.sticky > 0 && <Badge variant="default">{stickyLabel(row.sticky)}</Badge>}
					{row.closed > 0 && <Badge variant="secondary">Closed</Badge>}
					{row.digest > 0 && <Badge variant="outline">{digestLabel(row.digest)}</Badge>}
				</div>
			),
		},
		{
			key: "lastPost",
			header: "Last Post",
			cell: (row) => (row.lastPostAt ? new Date(row.lastPostAt * 1000).toLocaleDateString() : "—"),
		},
		{
			key: "actions",
			header: "",
			cell: (row) => (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button variant="ghost" size="icon" className="h-8 w-8">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditThread(row)}>Edit</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleToggleClose(row)}>
							{row.closed ? "Reopen" : "Close"}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleDelete(row)} className="text-destructive">
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
			className: "w-10",
		},
	];

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">Threads</h1>
				<p className="mt-1 text-sm text-muted-foreground">Manage forum threads.</p>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="rounded-xl border bg-card">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="No threads found"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			<ThreadEditDialog
				open={editThread !== null}
				onOpenChange={(open) => !open && setEditThread(null)}
				thread={editThread}
				loading={editLoading}
				onSave={handleEditSave}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				loading={confirmLoading}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
