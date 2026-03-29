"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type Attachment,
	batchDeleteAttachments,
	deleteAttachment,
	formatFileSize,
} from "@/viewmodels/admin/attachments";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [{ key: "search", label: "Search attachments...", type: "search" }];

const BATCH_ACTIONS: BatchAction[] = [
	{ key: "delete", label: "Delete Selected", variant: "destructive" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AttachmentsPage() {
	const [data, setData] = useState<Attachment[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		search: "",
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

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

				const res = await fetch(`/api/admin/attachments?${params.toString()}`);
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
		[pagination.limit],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ search: "" });
	}, []);

	const handleDelete = useCallback(
		(attachment: Attachment) => {
			setConfirmDialog({
				open: true,
				title: "Delete Attachment",
				description: `Delete "${attachment.filename}"? This cannot be undone.`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await deleteAttachment(attachment.aid);
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

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;
			if (key === "delete") {
				await batchDeleteAttachments(ids);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	const columns: ColumnDef<Attachment>[] = [
		{
			key: "filename",
			header: "Filename",
			cell: (row) => <span className="font-medium">{row.filename}</span>,
		},
		{
			key: "size",
			header: "Size",
			cell: (row) => formatFileSize(row.filesize),
			className: "text-right",
		},
		{ key: "author", header: "Author", cell: (row) => row.authorName },
		{ key: "thread", header: "Thread", cell: (row) => row.threadSubject },
		{
			key: "created",
			header: "Created",
			cell: (row) => new Date(row.createdAt).toLocaleDateString(),
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
				<h1 className="text-2xl font-semibold text-foreground">Attachments</h1>
				<p className="mt-1 text-sm text-muted-foreground">Manage file attachments.</p>
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
					getRowId={(r) => r.aid}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="No attachments found"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
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
