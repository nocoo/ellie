"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
import {
	type StatsJobKind,
	formatPercent,
	formatProcessedTotal,
	formatTickTime,
	percentValue,
	snapshotStatusLabel,
	snapshotStatusVariant,
} from "@/viewmodels/admin/stats-recalc";
import { useStatsRecalc } from "@/viewmodels/admin/use-stats-recalc";
import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ellie/ui";
import { Database, Loader2, MessageSquare, RefreshCw, RotateCcw, Users } from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Card config
// ---------------------------------------------------------------------------

interface CardConfig {
	kind: StatsJobKind;
	title: string;
	description: string;
	icon: React.ReactNode;
	/** Hint shown under the rows row when post-forums `processed != updated`. */
	processedSemantics?: string;
}

const CARDS: CardConfig[] = [
	{
		kind: "forums",
		title: "版块统计",
		description: "重新计算所有版块的主题数、帖子数和最后活动信息",
		icon: <Database className="h-5 w-5" />,
	},
	{
		kind: "threads",
		title: "主题统计",
		description: "分批重新计算所有主题的回复数和最后回复信息（job 模式）",
		icon: <MessageSquare className="h-5 w-5" />,
	},
	{
		kind: "users",
		title: "用户统计",
		description: "分批重新计算所有用户的主题数、回帖数和精华帖数（job 模式）",
		icon: <Users className="h-5 w-5" />,
	},
	{
		kind: "post-forums",
		title: "帖子版块同步",
		description: "将帖子的版块归属同步为其所属主题的当前版块（job 模式，已移除 5 万条上限）",
		icon: <RefreshCw className="h-5 w-5" />,
		processedSemantics: "扫描数 ≠ 修正数：post-forums 只更新与所属主题不一致的帖子。",
	},
];

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

function RecalcCard({ config }: { config: CardConfig }) {
	const { state, actions } = useStatsRecalc({ kind: config.kind });
	const { snapshot, loading, isPosting, error } = state;

	const [resetOpen, setResetOpen] = useState(false);

	const onPrimary = useCallback(() => {
		if (isPosting) return;
		void actions.advance();
	}, [actions, isPosting]);

	const onReset = useCallback(() => {
		if (isPosting) return;
		setResetOpen(false);
		void actions.reset();
	}, [actions, isPosting]);

	const status = snapshot?.status ?? null;
	const isTerminal = status === "done" || status === "failed";
	const isRunning = status === "running";
	const isDone = status === "done";
	// Done is terminal-success; the primary button is hidden in favour of
	// the 「重置」 ghost action so a stray click can't fire a no-op POST
	// (per reviewer msg=5c975973). Failed still shows 「重试」 — the
	// next POST will see status="failed" and refuse to advance without
	// reset:true, but the operator is asking explicitly so we surface
	// the button and let the soft 409 / reset flow take over.
	const showPrimary = !isDone;

	let primaryLabel = "开始计算";
	if (isPosting) primaryLabel = "正在请求…";
	else if (isRunning) primaryLabel = "运行中（自动推进）";
	else if (status === "failed") primaryLabel = "重试";

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
							{config.icon}
						</div>
						<CardTitle className="text-base">{config.title}</CardTitle>
					</div>
					{status && (
						<Badge variant={snapshotStatusVariant(status)}>{snapshotStatusLabel(status)}</Badge>
					)}
				</div>
				<CardDescription className="text-xs">{config.description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{loading && !snapshot ? (
					<div className="flex items-center text-xs text-muted-foreground">
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						加载状态中…
					</div>
				) : snapshot ? (
					<div className="space-y-2">
						{/* Progress bar */}
						<div>
							<div className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground">
									扫描进度 {formatProcessedTotal(snapshot.processed, snapshot.total)}
								</span>
								<span className="font-medium tabular-nums">
									{formatPercent(snapshot.processed, snapshot.total)}
								</span>
							</div>
							<div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-full bg-primary transition-all"
									style={{ width: `${percentValue(snapshot.processed, snapshot.total)}%` }}
								/>
							</div>
						</div>
						{/* Updated rows */}
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">累计修正</span>
							<span className="font-medium tabular-nums">
								{snapshot.updated.toLocaleString("zh-CN")}
							</span>
						</div>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">本批修正</span>
							<span className="font-medium tabular-nums">
								{snapshot.lastBatchUpdated.toLocaleString("zh-CN")}
							</span>
						</div>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">最后一次 tick</span>
							<span className="font-medium tabular-nums">
								{formatTickTime(snapshot.lastTickAt)}
							</span>
						</div>
						{config.processedSemantics && (
							<p className="text-[10px] text-muted-foreground">{config.processedSemantics}</p>
						)}
						{snapshot.status === "failed" && snapshot.error && (
							<p className="text-xs text-destructive">job 错误：{snapshot.error}</p>
						)}
					</div>
				) : (
					<p className="text-xs text-muted-foreground">尚未开始</p>
				)}

				{error && <p className="text-xs text-destructive">请求错误：{error}</p>}

				<div className="flex items-center justify-between gap-2">
					{showPrimary ? (
						<Button
							variant="outline"
							size="sm"
							onClick={onPrimary}
							disabled={isPosting || isRunning}
						>
							{isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{primaryLabel}
						</Button>
					) : (
						<span className="text-xs text-muted-foreground">已完成，无需进一步操作</span>
					)}
					{isTerminal && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setResetOpen(true)}
							disabled={isPosting}
						>
							<RotateCcw className="mr-1 h-4 w-4" />
							重置
						</Button>
					)}
				</div>
			</CardContent>

			<AdminConfirmDialog
				open={resetOpen}
				onOpenChange={(open) => !isPosting && setResetOpen(open)}
				title={`重置${config.title}`}
				description={`确定要重置${config.title}任务吗？这会丢弃当前进度并从头开始。`}
				variant="destructive"
				confirmLabel="重置"
				loading={isPosting}
				onConfirm={onReset}
			/>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatisticsPage() {
	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader
				title="统计计算"
				subtitle="分批重新计算数据库中的统计数据。点击「开始计算」后由前端自动以 ~1.5s 间隔推进，可随时关闭窗口再回来——KV 状态会保留 24h。"
			/>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{CARDS.map((card) => (
					<RecalcCard key={card.kind} config={card} />
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">说明</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground space-y-2">
					<p>
						<strong>job 模式</strong>
						：版块/主题/用户/帖子版块同步都以 KV 为状态机，每次 POST 推进一批，超时不会丢失进度。
					</p>
					<p>
						<strong>扫描 vs 修正</strong>
						：版块/主题/用户的「扫描数」基本等于「修正数」；帖子版块同步只更新与所属主题不一致的帖子，两者差距是历史不一致条数。
					</p>
					<p>
						<strong>并发安全</strong>
						：同一类型同一时刻只允许一个 tick 在执行。前端已限制单 in-flight，遇到 409
						会自动重试，不会变红灯。
					</p>
					<p className="text-xs">建议在低峰期执行；推进期间页面会以约 1.5 秒间隔自动轮询。</p>
				</CardContent>
			</Card>
		</div>
	);
}
