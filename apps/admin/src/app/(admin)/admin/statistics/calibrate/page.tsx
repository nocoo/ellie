"use client";

import { PageHeader } from "@/components/layout/page-header";
import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ellie/ui";
import { AlertCircle, Calculator, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
		<div className="space-y-6 md:space-y-8">
			<PageHeader
				title="统计校准"
				subtitle="查看和校准预计算的统计计数器。点击「运行统计」执行 COUNT(*) 查询获取真实值，然后选择「同步真实值」或手动调整偏移量。"
			/>

			{/* Today's posts card */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Calculator className="h-5 w-5" />
						</div>
						<div>
							<CardTitle className="text-base">今日发帖</CardTitle>
							<CardDescription className="text-xs">
								存储在 KV 中，每日北京时间 0 点重置
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">今日发帖：</span>
							<span className="font-medium tabular-nums">{formatNumber(todayPosts)}</span>
						</div>
						<div>
							<span className="text-muted-foreground">日期标记：</span>
							<span className="font-medium">{todayDate || "未初始化"}</span>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Main calibration card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<CardTitle className="text-base">计数器校准</CardTitle>
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
							<Button variant="outline" size="sm" onClick={fetchState} disabled={loading}>
								{loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
								刷新
							</Button>
							<Button variant="outline" size="sm" onClick={runStats} disabled={running}>
								{running && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
								运行统计
							</Button>
						</div>
					</div>
					<CardDescription>
						「存储值」是预计算的计数器，「真实值」是 COUNT(*) 查询结果（点击运行统计后显示）
					</CardDescription>
				</CardHeader>
				<CardContent>
					{error && (
						<div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					)}
					{success && (
						<div className="mb-4 rounded-md bg-green-500/10 p-3 text-sm text-green-600">
							{success}
						</div>
					)}

					<Table>
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
															? "text-muted-foreground"
															: diff > 0
																? "text-green-600"
																: "text-red-600"
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
												className="h-8 w-[100px] text-right tabular-nums ml-auto"
												value={offset}
												onChange={(e) => {
													const val = Number.parseInt(e.target.value, 10) || 0;
													setOffsets((prev) => ({ ...prev, [row.key]: val }));
												}}
												disabled={row.key === "stats.yesterday_posts"}
											/>
										</TableCell>
										<TableCell className="text-right tabular-nums font-medium">
											{offset !== 0 ? (
												<span className="text-primary">{formatNumber(final)}</span>
											) : (
												formatNumber(final)
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>

					<div className="mt-4 flex items-center justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={applyOffsets}
							disabled={applying || Object.values(offsets).every((v) => v === 0)}
						>
							{applying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
							应用偏移
						</Button>
						<Button size="sm" onClick={applyReal} disabled={applying || !hasDrift}>
							{applying && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
							<RefreshCw className="mr-1 h-4 w-4" />
							同步真实值
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Info card */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">说明</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground space-y-2">
					<p>
						<strong>预计算计数器</strong>
						：为避免 COUNT(*)
						全表扫描，论坛统计使用预计算的计数器。每次发帖、发主题、注册会自动递增。
					</p>
					<p>
						<strong>校准场景</strong>
						：如果出现数据不一致（如删除内容后计数器未递减），可使用此页面校准。
					</p>
					<p>
						<strong>运行统计</strong>
						：执行 COUNT(*) 查询获取真实值。这是一个昂贵的操作，仅在需要时执行。
					</p>
					<p>
						<strong>同步真实值</strong>
						：将所有存储值更新为真实值。这会重新执行 COUNT(*) 查询。
					</p>
					<p>
						<strong>应用偏移</strong>
						：在存储值基础上加减指定的偏移量，用于精细调整。
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
