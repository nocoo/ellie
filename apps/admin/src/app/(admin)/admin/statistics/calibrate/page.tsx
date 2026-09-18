"use client";

import { Badge, Button, Input, LayerCard } from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nocoo/basalt/components/table";
import {
	AlertCircle,
	Calculator,
	CheckCircle2,
	ListChecks,
	MessageSquare,
	RefreshCw,
	SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminMetrics } from "@/components/admin/admin-metrics";

// ─── Types ───────────────────────────────────────────────────

interface CounterRow {
	key: string;
	stored: number;
	real: number | null;
}

interface CalibrateGetResponse {
	data: {
		counters: CounterRow[];
		todayPosts: number;
		todayDate: string;
	};
}

interface CalibratePostResponse {
	data: {
		success: boolean;
		counters?: CounterRow[];
	};
}

// ─── Helpers ─────────────────────────────────────────────────

const COUNTER_LABELS: Record<string, string> = {
	"stats.total_threads": "总主题数",
	"stats.total_posts": "总帖子数",
	"stats.total_members": "总会员数",
	"stats.yesterday_posts": "昨日发帖数",
};

function formatNumber(n: number): string {
	return n.toLocaleString("zh-CN");
}

// ─── Page Component ──────────────────────────────────────────

export default function StatsCalibratePage() {
	const [counters, setCounters] = useState<CounterRow[]>([]);
	const [todayPosts, setTodayPosts] = useState(0);
	const [todayDate, setTodayDate] = useState("");
	const [offsets, setOffsets] = useState<Record<string, number>>({});
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Fetch current state
	const fetchState = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const res = await fetch("/api/admin/stats/calibrate");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as CalibrateGetResponse;
			setCounters(json.data.counters);
			setTodayPosts(json.data.todayPosts);
			setTodayDate(json.data.todayDate);
			setOffsets({});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to fetch");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchState();
	}, [fetchState]);

	// Run COUNT(*) queries
	const runStats = useCallback(async () => {
		try {
			setRunning(true);
			setError(null);
			setSuccess(null);
			const res = await fetch("/api/admin/stats/calibrate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "run_stats" }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as CalibratePostResponse;
			if (json.data?.success !== true) throw new Error("统计结果未确认，请重试");
			if (json.data.counters) {
				setCounters(json.data.counters);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to run stats");
		} finally {
			setRunning(false);
		}
	}, []);

	// Apply real values
	const applyReal = useCallback(async () => {
		try {
			setApplying(true);
			setError(null);
			setSuccess(null);
			const res = await fetch("/api/admin/stats/calibrate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "apply_real" }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as CalibratePostResponse;
			if (json.data?.success !== true) throw new Error("统计校准未确认保存，请重试");
			setSuccess("已同步到真实值");
			await fetchState();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to apply real");
		} finally {
			setApplying(false);
		}
	}, [fetchState]);

	// Apply offsets
	const applyOffsets = useCallback(async () => {
		const nonZeroOffsets = Object.fromEntries(Object.entries(offsets).filter(([, v]) => v !== 0));
		if (Object.keys(nonZeroOffsets).length === 0) {
			setError("没有偏移量需要应用");
			return;
		}
		try {
			setApplying(true);
			setError(null);
			setSuccess(null);
			const res = await fetch("/api/admin/stats/calibrate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "apply_offsets", offsets: nonZeroOffsets }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as CalibratePostResponse;
			if (json.data?.success !== true) throw new Error("统计校准未确认保存，请重试");
			setSuccess("偏移量已应用");
			await fetchState();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to apply offsets");
		} finally {
			setApplying(false);
		}
	}, [offsets, fetchState]);

	// Calculate final value with offset
	const getFinal = (row: CounterRow): number => {
		return row.stored + (offsets[row.key] ?? 0);
	};

	// Get diff between stored and real
	const getDiff = (row: CounterRow): number | null => {
		if (row.real === null) return null;
		return row.real - row.stored;
	};

	// Check if any counter has drift
	const hasDrift = counters.some((row) => {
		const diff = getDiff(row);
		return diff !== null && diff !== 0;
	});

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Calculator aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						统计校准
					</span>
				}
				description="比对展示计数与实际记录，查看差异并同步，或按需要手动调整。"
			/>

			<AdminMetrics
				items={[
					{
						label: "今日帖子（含首帖）",
						value: loading || error ? "—" : todayPosts,
						icon: MessageSquare,
						hint: todayDate ? `${todayDate} · 北京时间` : "每日 0 点重新计数",
					},
					{
						label: "已比对计数器",
						value:
							loading || error
								? "—"
								: `${counters.filter((r) => r.real !== null).length} / ${counters.length}`,
						icon: ListChecks,
						hint: "运行统计后显示真实值",
					},
					{
						label: "存在差异",
						value:
							loading || error || !counters.some((r) => r.real !== null)
								? "—"
								: counters.filter((r) => r.real !== null && r.real !== r.stored).length,
						icon: AlertCircle,
						hint: "真实值与存储值不一致",
					},
					{
						label: "待应用调整",
						value: Object.values(offsets).filter((v) => v !== 0).length,
						icon: SlidersHorizontal,
						hint: "本次填写的非零偏移",
					},
				]}
			/>

			{/* Main calibration card */}
			<LayerCard padding="none" className="overflow-hidden">
				<LayerCard.Header className="flex-col items-stretch gap-2 p-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-base font-medium">计数器校准</h2>
							{hasDrift && (
								<Badge variant="destructive" className="gap-1">
									<AlertCircle className="h-3 w-3" />
									存在偏差
								</Badge>
							)}
							{!hasDrift && counters.some((r) => r.real !== null) && (
								<Badge variant="default" className="gap-1">
									<CheckCircle2 className="h-3 w-3" />
									数据一致
								</Badge>
							)}
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={fetchState}
								disabled={loading || running || applying}
							>
								{loading && <Loader className="mr-1 h-4 w-4" />}
								刷新
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={runStats}
								disabled={loading || running || applying}
							>
								{running && <Loader className="mr-1 h-4 w-4" />}
								运行统计
							</Button>
						</div>
					</div>
					<p className="text-xs text-basalt-muted-foreground">
						偏差 = 真实值 − 存储值；最终值预览本次手动偏移后的结果。
					</p>
				</LayerCard.Header>
				<LayerCard.Well className="p-0">
					{error && <AdminInlineMessage variant="error" text={error} />}
					{success && <AdminInlineMessage variant="success" text={success} />}

					<section
						className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-basalt-ring"
						aria-label="计数器比对表格"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: this scroll region needs keyboard access
						tabIndex={0}
					>
						<Table
							aria-label="计数器比对"
							className="whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2"
						>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[180px]">计数器</TableHead>
									<TableHead className="text-right">存储值</TableHead>
									<TableHead className="text-right">真实值</TableHead>
									<TableHead className="text-right">偏差</TableHead>
									<TableHead className="text-right w-[120px]">调整偏移</TableHead>
									<TableHead className="text-right">最终值</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{loading && counters.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={6}
											className="h-24 text-center text-basalt-muted-foreground"
										>
											加载计数器…
										</TableCell>
									</TableRow>
								)}
								{counters.map((row) => {
									const diff = getDiff(row);
									const offset = offsets[row.key] ?? 0;
									const final = getFinal(row);

									return (
										<TableRow key={row.key}>
											<TableCell className="font-medium">
												{COUNTER_LABELS[row.key] ?? row.key}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatNumber(row.stored)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.real !== null ? formatNumber(row.real) : "—"}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{diff !== null ? (
													<span
														className={
															diff === 0
																? "text-basalt-muted-foreground"
																: diff > 0
																	? "text-basalt-primary"
																	: "text-basalt-danger"
														}
													>
														{diff > 0 ? "+" : ""}
														{formatNumber(diff)}
													</span>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell className="text-right">
												<Input
													type="number"
													aria-label={`${COUNTER_LABELS[row.key] ?? row.key}调整偏移`}
													className="h-8 w-[100px] text-right tabular-nums ml-auto"
													value={offset}
													onChange={(e) => {
														const val = Number.parseInt(e.target.value, 10) || 0;
														setOffsets((prev) => ({ ...prev, [row.key]: val }));
													}}
													disabled={
														loading || running || applying || row.key === "stats.yesterday_posts"
													}
												/>
											</TableCell>
											<TableCell className="text-right tabular-nums font-medium">
												{offset !== 0 ? (
													<span className="text-basalt-primary">{formatNumber(final)}</span>
												) : (
													formatNumber(final)
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</section>

					<div className="flex flex-wrap items-center justify-end gap-2 p-4">
						<Button
							variant="outline"
							size="sm"
							onClick={applyOffsets}
							disabled={
								loading || running || applying || Object.values(offsets).every((v) => v === 0)
							}
						>
							{applying && <Loader className="mr-1 h-4 w-4" />}
							应用偏移
						</Button>
						<Button
							size="sm"
							onClick={applyReal}
							disabled={loading || running || applying || !hasDrift}
						>
							{applying && <Loader className="mr-1 h-4 w-4" />}
							<RefreshCw className="mr-1 h-4 w-4" />
							同步真实值
						</Button>
					</div>
				</LayerCard.Well>
			</LayerCard>

			<LayerCard padding="sm">
				<div className="grid gap-4 text-xs text-basalt-muted-foreground md:grid-cols-3">
					<p>
						<strong className="mb-1 block text-basalt-foreground">运行统计</strong>
						按当前记录重新计数，用于比对，建议在低峰期执行。
					</p>
					<p>
						<strong className="mb-1 block text-basalt-foreground">同步真实值</strong>
						重新统计并更新展示计数，适合删除或迁移内容后出现偏差的情况。
					</p>
					<p>
						<strong className="mb-1 block text-basalt-foreground">应用偏移</strong>
						在存储值上加减所填数值。昨日发帖由系统维护，不能手动设置偏移。
					</p>
				</div>
			</LayerCard>
		</div>
	);
}
