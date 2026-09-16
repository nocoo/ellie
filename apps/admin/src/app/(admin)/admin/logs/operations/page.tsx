"use client";

import { Button, Input, Label, LayerCard } from "@nocoo/basalt";
import { Code } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Activity, Globe, ScrollText, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminLogDetailDialog } from "@/components/admin/admin-log-detail-dialog";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import {
	type AdminLog,
	type AdminLogFilters,
	adminLogActorKey,
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
	{ value: "user", label: "用户" },
	{ value: "thread", label: "主题" },
	{ value: "post", label: "回复" },
	{ value: "forum", label: "版块" },
	{ value: "report", label: "举报" },
	{ value: "attachment", label: "附件" },
	{ value: "ip_ban", label: "IP 封禁" },
	{ value: "censor_word", label: "敏感词" },
	{ value: "announcement", label: "公告" },
	{ value: "setting", label: "设置" },
];

const FILTERS: FilterDef[] = [
	{ key: "targetType", label: "目标类型", type: "select", options: TARGET_TYPE_OPTIONS },
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
						className="text-sm text-basalt-primary hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						{name} <span className="text-basalt-muted-foreground">#{row.adminId}</span>
					</Link>
				) : (
					<span className="text-sm">
						{name} <span className="text-basalt-muted-foreground">#{row.adminId}</span>
					</span>
				);
			},
		},
		{
			key: "action",
			header: "操作",
			cell: (row) => <Code className="px-1.5 py-0.5 text-xs">{row.action}</Code>,
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
							className="text-basalt-primary underline-offset-4 hover:underline"
							onClick={(e) => e.stopPropagation()}
						>
							{text}
						</Link>
					);
				}
				return <span className="text-sm text-basalt-muted-foreground">{text || "—"}</span>;
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
					<Button
						type="button"
						onClick={() => setSelectedLog(row)}
						className="block h-auto max-w-md truncate p-0 text-left text-xs text-basalt-muted-foreground"
						aria-label={`查看日志 #${row.id} 详情`}
						variant="link"
						size="sm"
					>
						{truncated || "(无)"}
					</Button>
				);
			},
		},
	];

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<ScrollText aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						操作日志
					</span>
				}
				description="管理员操作审计记录（只读）"
			/>
			<AdminMetrics
				items={[
					{
						label: "筛选结果",
						value: loading ? "—" : pagination.total,
						icon: ScrollText,
						hint: "当前条件下的全部记录",
					},
					{
						label: "本页操作账号",
						value: loading ? "—" : new Set(data.map(adminLogActorKey).filter(Boolean)).size,
						icon: Users,
						hint: "按邮箱或历史用户 ID 去重，不含系统任务",
					},
					{
						label: "本页操作类型",
						value: loading ? "—" : new Set(data.map((r) => r.action)).size,
						icon: Activity,
					},
					{
						label: "本页来源 IP",
						value: loading ? "—" : new Set(data.filter((r) => r.ip).map((r) => r.ip)).size,
						icon: Globe,
					},
				]}
			/>

			<LayerCard padding="sm" className="space-y-3">
				<AdminFilters
					filters={FILTERS}
					values={filters}
					onFilterChange={handleFilterChange}
					onClearAll={handleClearFilters}
				/>

				<div className="flex flex-wrap items-end gap-3 border-t border-basalt-border pt-3">
					<div className="grid gap-1">
						<Label htmlFor="filter-action" className="text-xs text-basalt-muted-foreground">
							操作代码（精确匹配）
						</Label>
						<form onSubmit={handleActionSubmit} className="relative">
							<Input
								id="filter-action"
								value={actionInput}
								onChange={(e) => setActionInput(e.target.value)}
								placeholder="如 user.ban，回车提交"
								className="h-8 w-56 max-w-full pr-8"
							/>
							{actionInput && (
								<Button
									type="button"
									onClick={handleActionClear}
									aria-label="清除 action 过滤"
									className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
									variant="ghost"
									size="icon"
								>
									<X aria-hidden="true" className="h-3.5 w-3.5" />
								</Button>
							)}
						</form>
					</div>
					<div className="grid gap-1">
						<Label htmlFor="filter-admin-id" className="text-xs text-basalt-muted-foreground">
							管理员 ID
						</Label>
						<Input
							id="filter-admin-id"
							type="number"
							inputMode="numeric"
							value={adminIdInput}
							onChange={(e) => setAdminIdInput(e.target.value)}
							placeholder="例如 1"
							className="h-8 w-28"
						/>
					</div>
					<div className="grid gap-1">
						<Label htmlFor="filter-target-id" className="text-xs text-basalt-muted-foreground">
							目标 ID
						</Label>
						<Input
							id="filter-target-id"
							type="number"
							inputMode="numeric"
							value={targetIdInput}
							onChange={(e) => setTargetIdInput(e.target.value)}
							placeholder="例如 3"
							className="h-8 w-28"
						/>
					</div>
					<div className="grid gap-1">
						<Label htmlFor="filter-start-date" className="text-xs text-basalt-muted-foreground">
							起始日期
						</Label>
						<Input
							id="filter-start-date"
							type="date"
							value={startDate}
							onChange={(e) => setStartDate(e.target.value)}
							className="h-8 w-40"
						/>
					</div>
					<div className="grid gap-1">
						<Label htmlFor="filter-end-date" className="text-xs text-basalt-muted-foreground">
							结束日期
						</Label>
						<Input
							id="filter-end-date"
							type="date"
							value={endDate}
							onChange={(e) => setEndDate(e.target.value)}
							className="h-8 w-40"
						/>
					</div>
				</div>
			</LayerCard>

			<LayerCard padding="none" className="overflow-hidden">
				<AdminDataTable
					label="操作日志列表"
					columns={columns}
					data={data}
					getRowId={(r) => r.id}
					loading={loading}
					emptyMessage="暂无操作日志"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</LayerCard>

			<AdminLogDetailDialog
				open={selectedLog !== null}
				onOpenChange={(open) => !open && setSelectedLog(null)}
				log={selectedLog}
			/>
		</div>
	);
}
