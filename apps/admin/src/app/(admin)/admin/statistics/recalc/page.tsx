"use client";

import { Badge, Button, LayerCard, Meter } from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Clock3, Database, MessageSquare, RefreshCw, RotateCcw, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import {
	formatPercent,
	formatProcessedTotal,
	formatTickTime,
	percentValue,
	type StatsJobKind,
	snapshotStatusLabel,
	snapshotStatusVariant,
} from "@/viewmodels/admin/stats-recalc";
import { useStatsRecalc } from "@/viewmodels/admin/use-stats-recalc";

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
		description: "重新计算主题回复数，更新最后回复及作者信息",
		icon: <MessageSquare className="h-5 w-5" />,
	},
	{
		kind: "users",
		title: "用户统计",
		description: "重新计算用户的主题、帖子（含首帖）和精华数量",
		icon: <Users className="h-5 w-5" />,
	},
	{
		kind: "post-forums",
		title: "帖子版块同步",
		description: "同步帖子与所属主题的版块，修复移动主题后的历史归属",
		icon: <RefreshCw className="h-5 w-5" />,
		processedSemantics: "仅修正与所属主题版块不一致的帖子，修正数即本轮发现的不一致记录数。",
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
	// Both done and failed are terminal — the worker `tickJob` returns
	// the current snapshot without advancing for either when reset is
	// not set (see apps/worker/src/lib/stats-job.ts:307). To prevent a
	// stray click from firing a no-op POST we hide the primary button
	// on either terminal state and force the operator through the
	// 「重置」 ghost action (per reviewer msg=5c975973 + msg=a4d18bc4).
	const showPrimary = !isTerminal;

	let primaryLabel = "开始计算";
	if (isPosting) primaryLabel = "处理中…";
	else if (isRunning) primaryLabel = "自动计算中";

	return (
		<LayerCard padding="sm" className="flex flex-col">
			<LayerCard.Header className="flex-col items-stretch gap-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-basalt-primary/10 text-basalt-primary">
							{config.icon}
						</div>
						<h2 className="text-base font-medium">{config.title}</h2>
					</div>
					{status && (
						<Badge variant={snapshotStatusVariant(status)}>{snapshotStatusLabel(status)}</Badge>
					)}
				</div>
				<p className="text-xs text-basalt-muted-foreground">{config.description}</p>
			</LayerCard.Header>
			<LayerCard.Well className="flex flex-1 flex-col gap-4">
				{loading && !snapshot ? (
					<div className="flex items-center text-xs text-basalt-muted-foreground">
						<Loader className="mr-2 h-4 w-4" />
						加载状态中…
					</div>
				) : snapshot ? (
					<div className="space-y-3">
						{/* Progress bar */}
						<div>
							<div className="flex items-center justify-between text-xs">
								<span className="text-basalt-muted-foreground">
									扫描进度 {formatProcessedTotal(snapshot.processed, snapshot.total)}
								</span>
								<span className="font-medium tabular-nums">
									{formatPercent(snapshot.processed, snapshot.total)}
								</span>
							</div>
							<Meter
								aria-label={`${config.title}扫描进度`}
								value={percentValue(snapshot.processed, snapshot.total)}
								hideValue
								className="mt-1"
							/>
						</div>
						<dl className="grid grid-cols-3 gap-3 text-xs">
							{[
								["已扫描", snapshot.processed],
								[config.kind === "post-forums" ? "累计修正" : "累计重算", snapshot.updated],
								[
									config.kind === "post-forums" ? "本批修正" : "本批重算",
									snapshot.lastBatchUpdated,
								],
							].map(([label, value]) => (
								<div key={label}>
									<dt className="text-basalt-muted-foreground">{label}</dt>
									<dd className="mt-1 text-xl font-semibold tabular-nums">
										{value.toLocaleString("zh-CN")}
									</dd>
								</div>
							))}
						</dl>
						<div className="flex flex-wrap items-center gap-1.5 text-xs text-basalt-muted-foreground">
							<Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
							最近更新 · {formatTickTime(snapshot.lastTickAt)}
						</div>
						{config.processedSemantics && (
							<p className="text-xs text-basalt-muted-foreground">{config.processedSemantics}</p>
						)}
						{snapshot.status === "failed" && snapshot.error && (
							<p className="text-xs text-basalt-destructive">计算失败：{snapshot.error}</p>
						)}
					</div>
				) : (
					<p className="py-5 text-sm text-basalt-muted-foreground">
						尚未开始，启动后将在此显示扫描进度。
					</p>
				)}

				{error && <p className="text-xs text-basalt-destructive">请求错误：{error}</p>}

				<div className="mt-auto flex items-center justify-between gap-2">
					{showPrimary ? (
						<Button
							variant="outline"
							size="sm"
							onClick={onPrimary}
							disabled={isPosting || isRunning}
						>
							{isPosting && <Loader className="mr-2 h-4 w-4" />}
							{primaryLabel}
						</Button>
					) : (
						<span className="text-xs text-basalt-muted-foreground">
							{status === "failed" ? "任务已失败，请「重置」后重试" : "已完成，无需进一步操作"}
						</span>
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
			</LayerCard.Well>

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
		</LayerCard>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatisticsPage() {
	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<RefreshCw aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						统计计算
					</span>
				}
				description="按需重算社区数据。任务分批推进，进度保留 24 小时，重新打开页面后可继续。"
			/>

			<div className="grid gap-4 lg:grid-cols-2">
				{CARDS.map((card) => (
					<RecalcCard key={card.kind} config={card} />
				))}
			</div>

			<LayerCard>
				<LayerCard.Header>
					<h2 className="text-base font-medium">说明</h2>
				</LayerCard.Header>
				<LayerCard.Well className="grid gap-4 text-xs text-basalt-muted-foreground md:grid-cols-3">
					<p>
						<strong className="mb-1 block text-basalt-foreground">进度保留</strong>
						页面打开时自动推进。关闭页面会暂停，24
						小时内返回可继续；已完成或失败的任务可重置后重算。
					</p>
					<p>
						<strong className="mb-1 block text-basalt-foreground">重算与修正</strong>
						版块、主题与用户统计会重新写入扫描结果；帖子版块同步仅更新存在归属差异的记录。
					</p>
					<p>
						<strong className="mb-1 block text-basalt-foreground">执行安排</strong>
						建议在低峰期进行全量重算。同一类型按批次处理，任务忙碌时页面会自动等待。
					</p>
				</LayerCard.Well>
			</LayerCard>
		</div>
	);
}
