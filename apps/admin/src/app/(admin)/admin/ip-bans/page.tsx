"use client";

import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	LayerCard,
} from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Clock3,
	Infinity as InfinityIcon,
	MoreHorizontal,
	Pencil,
	Plus,
	ScanLine,
	Search,
	ShieldBan,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminBatchBar, type BatchAction } from "@/components/admin/admin-batch-bar";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDataTable, type ColumnDef } from "@/components/admin/admin-data-table";
import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { AdminMetrics } from "@/components/admin/admin-metrics";
import { AdminPagination, type PaginationInfo } from "@/components/admin/admin-pagination";
import { IpBanCreateDialog } from "@/components/admin/ip-ban-create-dialog";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import { extractErrorMessage } from "@/lib/admin-error";
import { ipBanExpiryVariant, ipBanStateVariant } from "@/viewmodels/admin/badges";
import type { IpBan, IpBanCreate, IpBanUpdate, IpCheckResult } from "@/viewmodels/admin/ip-bans";
import {
	batchDeleteIpBans,
	createIpBan,
	deleteIpBan,
	formatExpiry,
	updateIpBan,
} from "@/viewmodels/admin/ip-bans";

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
	const [dialogError, setDialogError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	useEffect(() => {
		if (createDialogOpen || editBan) setDialogError(null);
	}, [createDialogOpen, editBan]);

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
			setDialogError(null);
			try {
				await createIpBan(data);
				setCreateDialogOpen(false);
				void fetchData(pagination.page);
			} catch (err) {
				setDialogError(extractErrorMessage(err, "创建 IP 封禁失败"));
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
			setDialogError(null);
			try {
				await updateIpBan(id, data);
				setEditBan(null);
				void fetchData(pagination.page);
			} catch (err) {
				setDialogError(extractErrorMessage(err, "保存 IP 封禁失败"));
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
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "删除 IP 封禁",
				description: `移除对 ${ban.ip} 的封禁？此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await deleteIpBan(ban.id);
						setConfirmDialog((d) => ({ ...d, open: false }));
						fetchData(pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "删除失败，请重试"));
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
		(key: string) => {
			const ids = Array.from(selectedIds).map(Number);
			if (key !== "delete" || ids.length === 0) return;
			setConfirmError(null);
			setConfirmDialog({
				open: true,
				title: "批量删除 IP 封禁",
				description: `将删除选中的 ${ids.length} 条IP 封禁规则，此操作不可撤销。`,
				variant: "destructive",
				onConfirm: async () => {
					setConfirmLoading(true);
					setConfirmError(null);
					try {
						await batchDeleteIpBans(ids);
						setSelectedIds(new Set());
						setConfirmDialog((dialog) => ({ ...dialog, open: false }));
						void fetchData(pagination.page);
					} catch (err) {
						setConfirmError(extractErrorMessage(err, "批量删除失败，请重试"));
					} finally {
						setConfirmLoading(false);
					}
				},
			});
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
			cell: (row) => (
				<span className="block max-w-64 truncate" title={row.reason}>
					{row.reason || "—"}
				</span>
			),
		},
		{
			key: "createdBy",
			header: "创建者",
			cell: (row) =>
				row.adminId > 0 ? (
					<Link
						href={`/admin/users/${row.adminId}`}
						className="text-basalt-primary hover:underline"
					>
						{row.adminName}
					</Link>
				) : (
					row.adminName
				),
		},
		{
			key: "state",
			header: "状态",
			cell: (row) => (
				<Badge variant={ipBanStateVariant(!row.expiresAt || row.expiresAt * 1000 > Date.now())}>
					{row.expiresAt && row.expiresAt * 1000 <= Date.now() ? "已过期" : "生效中"}
				</Badge>
			),
		},
		{
			key: "expiresAt",
			header: "过期时间",
			cell: (row) => {
				if (!row.expiresAt) return <Badge variant={ipBanExpiryVariant(false)}>永久</Badge>;
				const expired = row.expiresAt * 1000 < Date.now();
				return (
					<span className={expired ? "text-basalt-muted-foreground line-through" : ""}>
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
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label={`IP ${row.ip} 操作`}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => setEditBan(row)}>
							<Pencil className="mr-2 h-4 w-4" />
							编辑
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => handleDelete(row)} className="text-basalt-destructive">
							<Trash2 className="mr-2 h-4 w-4" />
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
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<ShieldBan aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						IP 封禁
					</span>
				}
				description="管理 IP 地址封禁"
				actions={
					<Button size="sm" onClick={() => setCreateDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						添加封禁
					</Button>
				}
			/>
			<AdminMetrics
				items={[
					{
						label: "筛选结果",
						value: loading ? "—" : pagination.total,
						icon: ShieldBan,
						hint: "当前条件下的全部规则",
					},
					{
						label: "本页生效规则",
						value: loading
							? "—"
							: data.filter((r) => !r.expiresAt || r.expiresAt * 1000 > Date.now()).length,
						icon: ShieldCheck,
					},
					{
						label: "本页永久封禁",
						value: loading ? "—" : data.filter((r) => !r.expiresAt).length,
						icon: InfinityIcon,
					},
					{
						label: "本页已过期",
						value: loading
							? "—"
							: data.filter((r) => !!r.expiresAt && r.expiresAt * 1000 <= Date.now()).length,
						icon: Clock3,
					},
				]}
			/>

			{/* IP Check Tool */}
			<LayerCard padding="sm" className="space-y-2">
				<h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
					<ScanLine aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
					IP 地址检测
				</h2>
				<div className="flex items-center gap-2">
					<Input
						aria-label="要检测的 IP 地址"
						placeholder="输入要检测的 IP 地址..."
						value={checkIpValue}
						onChange={(e) => setCheckIpValue(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleCheckIp()}
						className="h-8 min-w-0 max-w-xs"
					/>
					<Button
						variant="outline"
						size="sm"
						className="h-8 shrink-0"
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
									<p key={ban.id} className="text-sm text-basalt-muted-foreground">
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
			</LayerCard>

			<AdminFilters
				filters={FILTERS}
				values={filters}
				onFilterChange={handleFilterChange}
				onClearAll={handleClearFilters}
			/>

			<LayerCard padding="none" className="overflow-hidden">
				<AdminDataTable
					label="IP 封禁列表"
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
			</LayerCard>

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
				error={dialogError}
				onCreate={handleCreate}
			/>

			{/* Edit dialog */}
			<IpBanCreateDialog
				open={editBan !== null}
				onOpenChange={(open) => !open && setEditBan(null)}
				ipBan={editBan}
				loading={dialogLoading}
				error={dialogError}
				onUpdate={handleUpdate}
			/>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={confirmDialog.title}
				description={confirmDialog.description}
				variant={confirmDialog.variant}
				loading={confirmLoading}
				error={confirmError}
				onConfirm={confirmDialog.onConfirm}
			/>
		</div>
	);
}
