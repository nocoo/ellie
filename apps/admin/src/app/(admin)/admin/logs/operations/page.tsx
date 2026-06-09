"use client";

import { Input, Label } from "@ellie/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminLogDetailDialog } from "@/components/admin/admin-log-detail-dialog";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { PageHeader } from "@/components/layout/page-header";
import {
	type AdminLog,
	type AdminLogFilters,
	dateInputToUnix,
	formatLogTime,
	formatTarget,
	targetHref,
} from "@/viewmodels/admin/admin-logs";

// ---------------------------------------------------------------------------
// Filter definitions — search/select use the shared AdminFilters helper.
// adminId/targetId/date range live as inline inputs below to keep the table
// of filter types in AdminFilters small (one consumer).
// ---------------------------------------------------------------------------

const TARGET_TYPE_OPTIONS = [
	{ value: "user", label: "user" },
	{ value: "thread", label: "thread" },
	{ value: "post", label: "post" },
	{ value: "forum", label: "forum" },
	{ value: "report", label: "report" },
	{ value: "attachment", label: "attachment" },
	{ value: "ip_ban", label: "ip_ban" },
	{ value: "censor_word", label: "censor_word" },
	{ value: "announcement", label: "announcement" },
	{ value: "setting", label: "setting" },
];

// NOTE: AdminFilters' search type is hardcoded to write `filters.search` (not
// `filter.key`), so we cannot route an `action` filter through it. Action lives
// as an inline controlled input on this page; only the targetType select goes
// through AdminFilters.
const FILTERS: FilterDef[] = [
	{ key: "targetType", label: "targetType", type: "select", options: TARGET_TYPE_OPTIONS },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminLogsPage() {
	const [data, setData] = useState<AdminLog[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);

	const [filters, setFilters] = useState<Record<string, string>>({
		targetType: "",
	});
	const [actionInput, setActionInput] = useState("");
	const [actionFilter, setActionFilter] = useState("");
	const [adminIdInput, setAdminIdInput] = useState("");
	const [targetIdInput, setTargetIdInput] = useState("");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");

	const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);

	// -----------------------------------------------------------------------
	// Effective filters → API params
	// -----------------------------------------------------------------------

	const effectiveFilters: AdminLogFilters = useMemo(() => {
		const adminId = adminIdInput ? Number.parseInt(adminIdInput, 10) : Number.NaN;
		const targetId = targetIdInput ? Number.parseInt(targetIdInput, 10) : Number.NaN;
		return {
			action: actionFilter || undefined,
			targetType: filters.targetType || undefined,
			adminId: Number.isFinite(adminId) ? adminId : undefined,
			targetId: Number.isFinite(targetId) ? targetId : undefined,
			startDate: dateInputToUnix(startDate, "start"),
			endDate: dateInputToUnix(endDate, "end"),
		};
	}, [filters, actionFilter, adminIdInput, targetIdInput, startDate, endDate]);

	// -----------------------------------------------------------------------
	// Data fetching
	// -----------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (effectiveFilters.action) params.set("action", effectiveFilters.action);
				if (effectiveFilters.targetType) params.set("targetType", effectiveFilters.targetType);
				if (effectiveFilters.adminId != null)
					params.set("adminId", String(effectiveFilters.adminId));
				if (effectiveFilters.targetId != null)
					params.set("targetId", String(effectiveFilters.targetId));
				if (effectiveFilters.startDate != null)
					params.set("startDate", String(effectiveFilters.startDate));
				if (effectiveFilters.endDate != null)
					params.set("endDate", String(effectiveFilters.endDate));

				const res = await fetch(`/api/admin/admin-logs?${params.toString()}`);
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
		[effectiveFilters, pagination.limit],
	);

	useEffect(() => {
		fetchData(1);
	}, [fetchData]);

	const handlePageChange = useCallback((page: number) => fetchData(page), [fetchData]);

	const handleFilterChange = useCallback((key: string, value: string) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleClearFilters = useCallback(() => {
		setFilters({ targetType: "" });
		setActionInput("");
		setActionFilter("");
		setAdminIdInput("");
		setTargetIdInput("");
		setStartDate("");
		setEndDate("");
	}, []);

	const handleActionSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			setActionFilter(actionInput.trim());
		},
		[actionInput],
	);

	const handleActionClear = useCallback(() => {
		setActionInput("");
		setActionFilter("");
	}, []);

	// -----------------------------------------------------------------------
	// Columns — read-only; click row opens detail dialog.
	// -----------------------------------------------------------------------

	const columns: ColumnDef<AdminLog>[] = [
		{
			key: "createdAt",
			header: "时间",
			cell: (row) => (
				<span className="whitespace-nowrap text-sm">{formatLogTime(row.createdAt)}</span>
			),
			className: "w-[170px]",
		},
		{
			key: "admin",
			header: "管理员",
			cell: (row) => {
				const name = row.adminName || "(未命名)";
				return row.adminId > 0 ? (
					<Link
						href={`/admin/users/${row.adminId}`}
						className="text-sm text-primary hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						{name} <span className="text-muted-foreground">#{row.adminId}</span>
					</Link>
				) : (
					<span className="text-sm">
						{name} <span className="text-muted-foreground">#{row.adminId}</span>
					</span>
				);
			},
		},
		{
			key: "action",
			header: "Action",
			cell: (row) => (
				<code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.action}</code>
			),
		},
		{
			key: "target",
			header: "目标",
			cell: (row) => {
				const text = formatTarget(row.targetType, row.targetId);
				const href = targetHref(row.targetType, row.targetId);
				if (href) {
					return (
						<Link
							href={href}
							className="text-primary underline-offset-4 hover:underline"
							onClick={(e) => e.stopPropagation()}
						>
							{text}
						</Link>
					);
				}
				return <span className="text-sm text-muted-foreground">{text || "—"}</span>;
			},
		},
		{
			key: "ip",
			header: "IP",
			cell: (row) => (
				<div>
					<span className="font-mono text-xs">{row.ip || "—"}</span>
					{row.ip && <IpLookupInline ip={row.ip} />}
				</div>
			),
		},
		{
			key: "details",
			header: "详情",
			cell: (row) => {
				const text = (row.details ?? "").replace(/\s+/g, " ").trim();
				const truncated = text.length > 80 ? `${text.slice(0, 80)}…` : text;
				return (
					<button
						type="button"
						onClick={() => setSelectedLog(row)}
						className="block max-w-md truncate text-left text-xs text-muted-foreground hover:text-foreground"
						aria-label={`查看日志 #${row.id} 详情`}
					>
						{truncated || "(无)"}
					</button>
				);
			},
		},
	];

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader title="操作日志" subtitle="管理员操作审计记录（只读）" />

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<div className="flex flex-wrap items-end gap-3 rounded-xl bg-secondary p-3">
				<div className="grid gap-1">
					<Label htmlFor="filter-action" className="text-xs text-muted-foreground">
						Action（精确匹配）
					</Label>
					<form onSubmit={handleActionSubmit} className="relative">
						<Input
							id="filter-action"
							value={actionInput}
							onChange={(e) => setActionInput(e.target.value)}
							placeholder="如 user.ban，回车提交"
							className="w-56 pr-8"
						/>
						{actionInput && (
							<button
								type="button"
								onClick={handleActionClear}
								aria-label="清除 action 过滤"
								className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
							>
								×
							</button>
						)}
					</form>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="filter-admin-id" className="text-xs text-muted-foreground">
						管理员 ID
					</Label>
					<Input
						id="filter-admin-id"
						type="number"
						inputMode="numeric"
						value={adminIdInput}
						onChange={(e) => setAdminIdInput(e.target.value)}
						placeholder="例如 1"
						className="w-32"
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="filter-target-id" className="text-xs text-muted-foreground">
						目标 ID
					</Label>
					<Input
						id="filter-target-id"
						type="number"
						inputMode="numeric"
						value={targetIdInput}
						onChange={(e) => setTargetIdInput(e.target.value)}
						placeholder="例如 3"
						className="w-32"
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="filter-start-date" className="text-xs text-muted-foreground">
						起始日期
					</Label>
					<Input
						id="filter-start-date"
						type="date"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
						className="w-44"
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="filter-end-date" className="text-xs text-muted-foreground">
						结束日期
					</Label>
					<Input
						id="filter-end-date"
						type="date"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
						className="w-44"
					/>
				</div>
			</div>

			<div className="rounded-xl bg-secondary p-1 overflow-x-auto">
				<AdminDataTable
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					loading={loading}
					emptyMessage="暂无操作日志"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminLogDetailDialog
				open={selectedLog !== null}
				onOpenChange={(open) => !open && setSelectedLog(null)}
				log={selectedLog}
			/>
		</div>
	);
}
