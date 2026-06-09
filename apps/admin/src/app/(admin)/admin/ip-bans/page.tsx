"use client";

import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
} from "@ellie/ui";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { IpBanCreateDialog } from "@/components/admin/ip-ban-create-dialog";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { PageHeader } from "@/components/layout/page-header";
import { ipBanExpiryVariant, ipBanStateVariant } from "@/viewmodels/admin/badges";
import type { IpBan, IpBanCreate, IpBanUpdate, IpCheckResult } from "@/viewmodels/admin/ip-bans";
import { formatExpiry } from "@/viewmodels/admin/ip-bans";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const FILTERS: FilterDef[] = [{ key: "ip", label: "搜索 IP...", type: "search" }];

const BATCH_ACTIONS: BatchAction[] = [{ key: "delete", label: "批量删除", variant: "destructive" }];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function IpBansPage() {
	const [data, setData] = useState<IpBan[]>([]);
	const [pagination, setPagination] = useState<PaginationInfo>({
		page: 1,
		pages: 0,
		total: 0,
		limit: 20,
	});
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<Record<string, string>>({
		ip: "",
	});
	const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

	// Create/Edit dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editBan, setEditBan] = useState<IpBan | null>(null);
	const [dialogLoading, setDialogLoading] = useState(false);

	// Confirm dialog state
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		variant: "default" | "destructive";
		onConfirm: () => void;
	}>({ open: false, title: "", description: "", variant: "default", onConfirm: () => {} });
	const [confirmLoading, setConfirmLoading] = useState(false);

	// IP check tool state
	const [checkIpValue, setCheckIpValue] = useState("");
	const [checkResult, setCheckResult] = useState<IpCheckResult | null>(null);
	const [checkLoading, setCheckLoading] = useState(false);

	// ---------------------------------------------------------------------------
	// Data fetching
	// ---------------------------------------------------------------------------

	const fetchData = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams();
				params.set("page", String(page));
				params.set("limit", String(pagination.limit));
				if (filters.ip) params.set("ip", filters.ip);

				const res = await fetch(`/api/admin/ip-bans?${params.toString()}`);
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
		setFilters({ ip: "" });
	}, []);

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	const handleCreate = useCallback(
		async (data: IpBanCreate) => {
			setDialogLoading(true);
			try {
				await fetch("/api/admin/ip-bans", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				setCreateDialogOpen(false);
				fetchData(pagination.page);
			} finally {
				setDialogLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	// ---------------------------------------------------------------------------
	// Edit
	// ---------------------------------------------------------------------------

	const handleUpdate = useCallback(
		async (id: number, data: IpBanUpdate) => {
			setDialogLoading(true);
			try {
				await fetch(`/api/admin/ip-bans/${id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				setEditBan(null);
				fetchData(pagination.page);
			} finally {
				setDialogLoading(false);
			}
		},
		[fetchData, pagination.page],
	);

	// ---------------------------------------------------------------------------
	// Delete
	// ---------------------------------------------------------------------------

	const handleDelete = useCallback(
		(ban: IpBan) => {
			setConfirmDialog({
				open: true,
				title: "删除 IP 封禁",
				description: `移除对 ${ban.ip} 的封禁？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					try {
						await fetch(`/api/admin/ip-bans/${ban.id}`, { method: "DELETE" });
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
				await fetch("/api/admin/ip-bans/batch-delete", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ids }),
				});
			}
			setSelectedIds(new Set());
			fetchData(pagination.page);
		},
		[selectedIds, fetchData, pagination.page],
	);

	// ---------------------------------------------------------------------------
	// IP check tool
	// ---------------------------------------------------------------------------

	const handleCheckIp = useCallback(async () => {
		if (!checkIpValue.trim()) return;
		setCheckLoading(true);
		setCheckResult(null);
		try {
			const res = await fetch(
				`/api/admin/ip-bans/check-ip?ip=${encodeURIComponent(checkIpValue.trim())}`,
			);
			const json = await res.json();
			setCheckResult(json.data ?? null);
		} catch {
			setCheckResult(null);
		} finally {
			setCheckLoading(false);
		}
	}, [checkIpValue]);

	// ---------------------------------------------------------------------------
	// Column definitions
	// ---------------------------------------------------------------------------

	const columns: ColumnDef<IpBan>[] = [
		{
			key: "ip",
			header: "IP / 范围",
			cell: (row) => (
				<div>
					<span className="font-mono text-sm">{row.ip}</span>
					<IpLookupInline ip={row.ip} />
				</div>
			),
		},
		{
			key: "reason",
			header: "原因",
			cell: (row) => row.reason || <span className="text-muted-foreground">—</span>,
		},
		{
			key: "createdBy",
			header: "创建者",
			cell: (row) =>
				row.adminId > 0 ? (
					<Link href={`/admin/users/${row.adminId}`} className="text-primary hover:underline">
						{row.adminName}
					</Link>
				) : (
					row.adminName
				),
		},
		{
			key: "expiresAt",
			header: "过期时间",
			cell: (row) => {
				if (!row.expiresAt) return <Badge variant={ipBanExpiryVariant(false)}>永久</Badge>;
				const expired = row.expiresAt * 1000 < Date.now();
				return (
					<span className={expired ? "text-muted-foreground line-through" : ""}>
						{formatExpiry(row.expiresAt)}
					</span>
				);
			},
		},
		{
			key: "createdAt",
			header: "创建时间",
			cell: (row) => new Date(row.createdAt * 1000).toLocaleDateString(),
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
						<DropdownMenuItem onClick={() => setEditBan(row)}>编辑</DropdownMenuItem>
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
		<div className="space-y-6 md:space-y-8">
			<PageHeader
				title="IP 封禁"
				subtitle="管理 IP 地址封禁"
				action={
					<Button onClick={() => setCreateDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						添加封禁
					</Button>
				}
			/>

			{/* IP Check Tool */}
			<div className="rounded-xl bg-secondary p-1 overflow-x-auto p-4">
				<h2 className="mb-2 text-sm font-medium text-foreground">IP 地址检测</h2>
				<div className="flex items-center gap-2">
					<Input
						placeholder="输入要检测的 IP 地址..."
						value={checkIpValue}
						onChange={(e) => setCheckIpValue(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleCheckIp()}
						className="max-w-xs"
					/>
					<Button
						variant="outline"
						onClick={handleCheckIp}
						disabled={checkLoading || !checkIpValue.trim()}
					>
						<Search className="mr-2 h-4 w-4" />
						{checkLoading ? "检测中..." : "检测"}
					</Button>
				</div>
				{checkResult && (
					<div className="mt-3">
						{checkResult.banned ? (
							<div className="space-y-1">
								<Badge variant={ipBanStateVariant(true)}>已封禁</Badge>
								{checkResult.matchingBans?.map((ban) => (
									<p key={ban.id} className="text-sm text-muted-foreground">
										匹配规则 <span className="font-mono">{ban.ip}</span>
										{ban.reason ? ` — ${ban.reason}` : ""}
										{ban.expiresAt ? ` (过期时间 ${formatExpiry(ban.expiresAt)})` : " (永久)"}
									</p>
								))}
							</div>
						) : (
							<Badge variant={ipBanStateVariant(false)}>未封禁</Badge>
						)}
					</div>
				)}
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
					emptyMessage="暂无 IP 封禁记录"
				/>
				<AdminPagination pagination={pagination} onPageChange={handlePageChange} />
			</div>

			<AdminBatchBar
				selectedCount={selectedIds.size}
				actions={BATCH_ACTIONS}
				onAction={handleBatchAction}
				onClear={() => setSelectedIds(new Set())}
			/>

			{/* Create dialog */}
			<IpBanCreateDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				loading={dialogLoading}
				onCreate={handleCreate}
			/>

			{/* Edit dialog */}
			<IpBanCreateDialog
				open={editBan !== null}
				onOpenChange={(open) => !open && setEditBan(null)}
				ipBan={editBan}
				loading={dialogLoading}
				onUpdate={handleUpdate}
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
