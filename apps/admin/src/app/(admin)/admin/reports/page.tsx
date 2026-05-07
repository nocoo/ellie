"use client";

import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { reportStatusVariant, reportTypeVariant } from "@/viewmodels/admin/badges";
import {
	REPORT_STATUS_OPTIONS,
	REPORT_TYPE_OPTIONS,
	type Report,
	type ReportType,
	STATUS_LABELS,
	TYPE_LABELS,
	batchDeleteReports,
	fetchReports,
	getReportTargetAdminLink,
	getReportTargetLabel,
	updateReportStatus,
} from "@/viewmodels/admin/reports";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ellie/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ellie/ui";
import { ExternalLink, Eye, MoreHorizontal, RefreshCw } from "lucide-react";
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
	{
		key: "type",
		label: "类型",
		type: "select",
		options: REPORT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
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
	const [filters, setFilters] = useState<Record<string, string>>({ status: "", type: "" });
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

	// Detail dialog state
	const [detailReport, setDetailReport] = useState<Report | null>(null);

	// ---------------------------------------------------------------------------
	// Data fetching
	// ---------------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			// Clear selection when data changes to prevent cross-page/filter batch operations
			setSelectedIds(new Set());
			try {
				const result = await fetchReports({
					page,
					limit: pagination.limit,
					status: (filters.status as "pending" | "resolved" | "dismissed") || undefined,
					type: (filters.type as ReportType) || undefined,
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
		setFilters({ status: "", type: "" });
	}, []);

	// ---------------------------------------------------------------------------
	// Status update
	// ---------------------------------------------------------------------------

	const handleStatusChange = useCallback(
		async (report: Report, newStatus: "resolved" | "dismissed") => {
			try {
				await updateReportStatus(report.id, newStatus);
				fetchData(pagination.page);
				// Close detail dialog if open
				if (detailReport?.id === report.id) {
					setDetailReport(null);
				}
			} catch {
				// Error handling already done in updateReportStatus
			}
		},
		[fetchData, pagination.page, detailReport],
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
						// Close detail dialog if open
						if (detailReport?.id === report.id) {
							setDetailReport(null);
						}
					} finally {
						setConfirmLoading(false);
					}
				},
			});
		},
		[fetchData, pagination.page, detailReport],
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

	const formatDateTime = (timestamp: number) => {
		return new Date(timestamp * 1000).toLocaleString("zh-CN");
	};

	// ---------------------------------------------------------------------------
	// Column definitions
	// ---------------------------------------------------------------------------

	const columns: ColumnDef<Report>[] = [
		{
			key: "id",
			header: "ID",
			cell: (row) => (
				<button
					type="button"
					onClick={() => setDetailReport(row)}
					className="text-muted-foreground hover:text-primary hover:underline cursor-pointer"
				>
					#{row.id}
				</button>
			),
			className: "w-16",
		},
		{
			key: "type",
			header: "类型",
			cell: (row) => <Badge variant={reportTypeVariant(row.type)}>{TYPE_LABELS[row.type]}</Badge>,
			className: "w-16",
		},
		{
			key: "targetId",
			header: "举报对象",
			cell: (row) => {
				const link = getReportTargetAdminLink(row);
				const label = getReportTargetLabel(row);
				return link ? (
					<Link
						href={link}
						className="flex items-center gap-1 text-primary hover:underline max-w-[20rem] truncate"
						title={label}
					>
						<span className="truncate">{label}</span>
						<ExternalLink className="h-3 w-3 shrink-0" />
					</Link>
				) : (
					<span className="text-muted-foreground" title={label}>
						{label}
					</span>
				);
			},
		},
		{
			key: "reporterName",
			header: "举报人",
			cell: (row) =>
				row.reporterId > 0 ? (
					<Link href={`/admin/users/${row.reporterId}`} className="text-primary hover:underline">
						{row.reporterName}
					</Link>
				) : (
					<span>{row.reporterName}</span>
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
			cell: (row) => formatDateTime(row.createdAt),
		},
		{
			key: "status",
			header: "状态",
			cell: (row) => (
				<Badge variant={reportStatusVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
			),
		},
		{
			key: "handlerName",
			header: "处理人",
			cell: (row) => {
				if (!row.handlerName) return <span className="text-muted-foreground">—</span>;
				return row.handlerId != null && row.handlerId > 0 ? (
					<Link
						href={`/admin/users/${row.handlerId}`}
						className="text-sm text-primary hover:underline"
					>
						{row.handlerName}
					</Link>
				) : (
					<span className="text-sm">{row.handlerName}</span>
				);
			},
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
						<DropdownMenuItem onClick={() => setDetailReport(row)}>
							<Eye className="h-4 w-4 mr-2" />
							查看详情
						</DropdownMenuItem>
						{(() => {
							const link = getReportTargetAdminLink(row);
							if (!link) return null;
							return (
								<DropdownMenuItem
									onClick={() => {
										window.open(link, "_blank");
									}}
								>
									<ExternalLink className="h-4 w-4 mr-2" />
									查看{TYPE_LABELS[row.type]}
								</DropdownMenuItem>
							);
						})()}
						<DropdownMenuSeparator />
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
					<p className="mt-1 text-sm text-muted-foreground">处理用户举报的主题、回帖与用户</p>
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

			{/* Detail dialog */}
			<Dialog open={detailReport !== null} onOpenChange={(open) => !open && setDetailReport(null)}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>举报详情 #{detailReport?.id}</DialogTitle>
						<DialogDescription>查看举报的详细信息</DialogDescription>
					</DialogHeader>
					{detailReport && (
						<div className="space-y-4 py-2">
							<div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
								<span className="text-muted-foreground">类型</span>
								<span>
									<Badge variant={reportTypeVariant(detailReport.type)}>
										{TYPE_LABELS[detailReport.type]}
									</Badge>
								</span>

								<span className="text-muted-foreground">举报对象</span>
								<span>
									{(() => {
										const link = getReportTargetAdminLink(detailReport);
										const label = getReportTargetLabel(detailReport);
										return link ? (
											<Link
												href={link}
												className="text-primary hover:underline inline-flex items-center gap-1"
											>
												{label}
												<ExternalLink className="h-3 w-3" />
											</Link>
										) : (
											<span>{label}</span>
										);
									})()}
									<span className="text-muted-foreground ml-1">(ID: {detailReport.targetId})</span>
								</span>

								<span className="text-muted-foreground">举报人</span>
								<span>
									{detailReport.reporterId > 0 ? (
										<Link
											href={`/admin/users/${detailReport.reporterId}`}
											className="text-primary hover:underline"
										>
											{detailReport.reporterName}
										</Link>
									) : (
										detailReport.reporterName
									)}
									<span className="text-muted-foreground ml-1">
										(UID: {detailReport.reporterId})
									</span>
								</span>

								<span className="text-muted-foreground">举报理由</span>
								<span>{detailReport.reason}</span>

								<span className="text-muted-foreground">举报时间</span>
								<span>{formatDateTime(detailReport.createdAt)}</span>

								<span className="text-muted-foreground">当前状态</span>
								<span>
									<Badge variant={reportStatusVariant(detailReport.status)}>
										{STATUS_LABELS[detailReport.status]}
									</Badge>
								</span>

								{detailReport.handlerName && (
									<>
										<span className="text-muted-foreground">处理人</span>
										<span>
											{detailReport.handlerId != null && detailReport.handlerId > 0 ? (
												<Link
													href={`/admin/users/${detailReport.handlerId}`}
													className="text-primary hover:underline"
												>
													{detailReport.handlerName}
												</Link>
											) : (
												detailReport.handlerName
											)}
										</span>
									</>
								)}

								{detailReport.handledAt && (
									<>
										<span className="text-muted-foreground">处理时间</span>
										<span>{formatDateTime(detailReport.handledAt)}</span>
									</>
								)}
							</div>
						</div>
					)}
					<DialogFooter className="gap-2 sm:gap-0">
						{detailReport?.status === "pending" && (
							<>
								<Button
									variant="outline"
									onClick={() => handleStatusChange(detailReport, "dismissed")}
								>
									驳回举报
								</Button>
								<Button onClick={() => handleStatusChange(detailReport, "resolved")}>
									标记已处理
								</Button>
							</>
						)}
						{detailReport?.status !== "pending" && (
							<Button variant="outline" onClick={() => setDetailReport(null)}>
								关闭
							</Button>
						)}
						<Button
							variant="destructive"
							onClick={() => detailReport && handleDelete(detailReport)}
						>
							删除
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
