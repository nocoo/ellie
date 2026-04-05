"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type Report,
	REPORT_STATUS_OPTIONS,
	STATUS_COLORS,
	STATUS_LABELS,
	batchDeleteReports,
	fetchReports,
	updateReportStatus,
} from "@/viewmodels/admin/reports";
import { ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [
	{
		key: "status",
		label: "状态",
		type: "select",
		options: REPORT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
	},
];

const BATCH_ACTIONS: BatchAction[] = [{ key: "delete", label: "批量删除", variant: "destructive" }];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ReportsPage() {
	const [data, setData] = useState<Report[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({ status: "" });
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Confirm dialog state
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// ---------------------------------------------------------------------------
	// Data fetching
	// ---------------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const result = await fetchReports({
					page,
					limit: pagination.limit,
					status: (filters.status as "pending" | "resolved" | "dismissed") || undefined,
				});
				setData(result.data);
				setPagination({
					page: result.meta.page,
					pages: result.meta.pages,
					total: result.meta.total,
					limit: result.meta.limit,
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
		setFilters({ status: "" });
	}, []);

	// ---------------------------------------------------------------------------
	// Status update
	// ---------------------------------------------------------------------------

	const handleStatusChange = useCallback(
		async (report: Report, newStatus: "resolved" | "dismissed") => {
			try {
				await updateReportStatus(report.id, newStatus);
				fetchData(pagination.page);
			} catch {
				// Error handling already done in updateReportStatus
			}
		},
		[fetchData, pagination.page],
	);

	// ---------------------------------------------------------------------------
	// Delete
	// ---------------------------------------------------------------------------

	const handleDelete = useCallback(
		(report: Report) => {
			setConfirmDialog({
				open: true,
				title: "删除举报",
				description: `确定要删除举报 #${report.id} 吗？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await batchDeleteReports([report.id]);
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

	// ---------------------------------------------------------------------------
	// Batch actions
	// ---------------------------------------------------------------------------

	const handleBatchAction = useCallback(
		async (key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (ids.length === 0) return;
			if (key === "delete") {
				await batchDeleteReports(ids);
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	const getPostLink = (report: Report) => {
		if (!report.threadId) return null;
		return `/threads/${report.threadId}#post-${report.targetId}`;
	};

	// ---------------------------------------------------------------------------
	// Column definitions
	// ---------------------------------------------------------------------------

	const columns: ColumnDef<Report>[] = [
		{
			key: "id",
			header: "ID",
			cell: (row) => <span className="text-muted-foreground">#{row.id}</span>,
			className: "w-16",
		},
		{
			key: "targetId",
			header: "举报帖子",
			cell: (row) => {
				const link = getPostLink(row);
				return link ? (
					<Link
						href={link}
						target="_blank"
						className="flex items-center gap-1 text-primary hover:underline"
					>
						#{row.targetId}
						<ExternalLink className="h-3 w-3" />
					</Link>
				) : (
					<span className="text-muted-foreground">#{row.targetId}</span>
				);
			},
		},
		{
			key: "reporterName",
			header: "举报人",
			cell: (row) => (
				<Link href={`/admin/users?id=${row.reporterId}`} className="text-primary hover:underline">
					{row.reporterName}
				</Link>
			),
		},
		{
			key: "reason",
			header: "理由",
			cell: (row) => row.reason,
		},
		{
			key: "createdAt",
			header: "举报时间",
			cell: (row) => new Date(row.createdAt * 1000).toLocaleString("zh-CN"),
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => {
				const colors = STATUS_COLORS[row.status];
				return <Badge className={`${colors.bg} ${colors.text}`}>{STATUS_LABELS[row.status]}</Badge>;
			},
		},
		{
			key: "handlerName",
			header: "处理人",
			cell: (row) =>
				row.handlerName ? (
					<span className="text-sm">{row.handlerName}</span>
				) : (
					<span className="text-muted-foreground">—</span>
				),
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
						{getPostLink(row) && (
							<>
								<DropdownMenuItem
									onClick={() => window.open(getPostLink(row)!, "_blank")}
								>
									查看帖子
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						{row.status === "pending" && (
							<>
								<DropdownMenuItem onClick={() => handleStatusChange(row, "resolved")}>
									标记已处理
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => handleStatusChange(row, "dismissed")}>
									驳回举报
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						<DropdownMenuItem onClick={() => handleDelete(row)} className="text-destructive">
							删除
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
			className: "w-10",
		},
	];

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">举报管理</h1>
					<p className="mt-1 text-sm text-muted-foreground">处理用户举报的帖子</p>
				</div>
				<Button variant="outline" onClick={() => fetchData(pagination.page)} disabled={loading}>
					<RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
					刷新
				</Button>
			</div>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="rounded-xl bg-secondary p-1 overflow-x-auto">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					selectable
					selectedIds={selectedIds}
					onSelectionChange={setSelectedIds}
					loading={loading}
					emptyMessage="暂无举报记录"
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
