"use client";

import { formatNumber } from "@ellie/shared";
import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { AreaChart } from "@nocoo/basalt/charts/area";
import { DonutChart } from "@nocoo/basalt/charts/donut";
import {
	Activity,
	ArrowUpRight,
	Bot,
	ChartNoAxesCombined,
	Fingerprint,
	Globe,
	LogIn,
	MessagesSquare,
	ShieldCheck,
	Users,
} from "lucide-react";
import Link from "next/link";
import { metricShare, summarizeTrend } from "@/viewmodels/admin/analytics";
import {
	type DashboardActivity as ActivityData,
	contentTrendRows,
} from "@/viewmodels/admin/dashboard";
import { AdminMetrics } from "./admin-metrics";

const CONTENT_SERIES = [
	{ key: "threads" as const, label: "新主题", color: "hsl(var(--basalt-chart-1))" },
	{ key: "posts" as const, label: "新帖子（含首帖）", color: "hsl(var(--basalt-chart-3))" },
];

export function DashboardActivity({ activity }: { activity: ActivityData }) {
	const { visits, logins, forums } = activity;
	const trend = contentTrendRows(activity);
	const threadSummary = activity.threads ? summarizeTrend(activity.threads.series) : null;
	const postSummary = activity.posts ? summarizeTrend(activity.posts.series) : null;
	const sources = visits
		? [
				{ name: "真人", value: visits.humanViews },
				{ name: "搜索爬虫", value: visits.botSearchViews },
				{ name: "其他爬虫", value: visits.botOtherViews },
				{ name: "未识别", value: visits.unknownViews },
			]
		: [];
	const forumTotal = forums?.rows.reduce((sum, row) => sum + row.posts, 0) ?? 0;
	return (
		<div className="space-y-4">
			<AdminMetrics
				label="今日访问与登录"
				items={[
					{
						label: "今日浏览",
						value: visits?.totalViews ?? "—",
						icon: Globe,
						hint: visits
							? `真人 ${metricShare(visits.humanViews, visits.totalViews)} · 上海时区`
							: "访问数据暂不可用",
					},
					{
						label: "活跃登录用户",
						value: visits?.activeUsers ?? "—",
						icon: Users,
						hint: visits
							? visits.anonPresent
								? "另有匿名访问，不计入用户数"
								: "仅统计已登录账号"
							: "访问数据暂不可用",
					},
					{
						label: "登录 / 注册成功率",
						value: logins ? metricShare(logins.successAttempts, logins.totalAttempts) : "—",
						icon: ShieldCheck,
						hint: logins
							? `${formatNumber(logins.failedAttempts)} 次失败 / ${formatNumber(logins.totalAttempts)} 次尝试`
							: "登录数据暂不可用",
					},
					{
						label: "认证来源 IP",
						value: logins?.uniqueIps ?? "—",
						icon: Fingerprint,
						hint: logins
							? `${formatNumber(logins.uniqueUsers)} 个用户 · 今日去重`
							: "登录数据暂不可用",
					},
				]}
			/>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<LayerCard className="min-w-0">
					<LayerCard.Header className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<ChartNoAxesCombined className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							内容增长
						</h2>
						<Button asChild variant="ghost" size="sm">
							<Link href="/admin/analytics">
								近 7 天 <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</Button>
					</LayerCard.Header>
					<LayerCard.Well className="min-w-0 flex-1 space-y-3">
						<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-basalt-muted-foreground">
							<span>
								新主题{" "}
								<strong className="ml-1.5 text-base font-semibold text-basalt-foreground tabular-nums">
									{threadSummary ? formatNumber(threadSummary.total) : "—"}
								</strong>
							</span>
							<span>
								新帖子（含首帖）{" "}
								<strong className="ml-1.5 text-base font-semibold text-basalt-foreground tabular-nums">
									{postSummary ? formatNumber(postSummary.total) : "—"}
								</strong>
							</span>
							<span>
								日均帖子{" "}
								<strong className="ml-1.5 text-basalt-foreground tabular-nums">
									{postSummary?.average == null
										? "—"
										: postSummary.average.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}
								</strong>
							</span>
						</div>
						{!activity.threads || !activity.posts ? (
							<p role="status" className="text-xs text-basalt-destructive">
								部分趋势暂不可用，缺失数据不计为零。
							</p>
						) : null}
						{trend.length ? (
							<AreaChart
								data={trend}
								series={CONTENT_SERIES}
								showAxes
								showLegend
								className="h-64 w-full"
								ariaLabel="近七天主题与帖子趋势"
								xValueFormatter={(date) => String(date).slice(5)}
								valueFormatter={formatNumber}
								summary="按上海时区统计最近七天，包含尚未结束的今天。"
							/>
						) : (
							<p className="py-16 text-center text-sm text-basalt-muted-foreground">暂无可用趋势</p>
						)}
					</LayerCard.Well>
				</LayerCard>

				<LayerCard className="min-w-0">
					<LayerCard.Header className="flex items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<Globe className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							访问构成
						</h2>
						<Button asChild variant="ghost" size="sm">
							<Link href="/admin/analytics?tab=audit">
								访问明细 <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</Button>
					</LayerCard.Header>
					<LayerCard.Well className="flex flex-1 flex-col justify-between">
						{visits ? (
							<>
								<div className="flex flex-wrap items-center justify-center gap-3">
									{visits.totalViews > 0 && (
										<DonutChart
											data={sources}
											ariaLabel="今日访问来源构成"
											summary={`共 ${formatNumber(visits.totalViews)} 次访问，真人占 ${metricShare(visits.humanViews, visits.totalViews)}。`}
										/>
									)}
									<dl className="min-w-36 flex-1 space-y-2.5 text-xs">
										{sources.map((source, index) => (
											<div key={source.name} className="flex items-center justify-between gap-3">
												<dt className="flex items-center gap-2 text-basalt-muted-foreground">
													<span
														aria-hidden="true"
														className="h-2 w-2 rounded-full"
														style={{ background: `hsl(var(--basalt-chart-${index + 1}))` }}
													/>
													{source.name}
												</dt>
												<dd className="font-medium tabular-nums">
													{formatNumber(source.value)}{" "}
													<span className="ml-1 text-basalt-muted-foreground">
														{metricShare(source.value, visits.totalViews)}
													</span>
												</dd>
											</div>
										))}
									</dl>
								</div>
								<div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-basalt-border/50 pt-3 text-xs text-basalt-muted-foreground">
									<span className="flex items-center gap-1.5">
										<Activity className="h-3.5 w-3.5" aria-hidden="true" />
										{formatNumber(visits.distinctTargets)} 个访问目标
									</span>
									<span className="flex items-center gap-1.5">
										<Bot className="h-3.5 w-3.5" aria-hidden="true" />
										爬虫{" "}
										{metricShare(visits.botSearchViews + visits.botOtherViews, visits.totalViews)}
									</span>
								</div>
							</>
						) : (
							<p className="py-12 text-center text-sm text-basalt-muted-foreground">
								访问数据暂不可用
							</p>
						)}
					</LayerCard.Well>
				</LayerCard>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<LayerCard className="min-w-0">
					<LayerCard.Header className="flex items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<MessagesSquare className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							版块活跃度
						</h2>
						<Badge variant="secondary">近 7 天 · 帖子数</Badge>
					</LayerCard.Header>
					<LayerCard.Well className="flex-1 space-y-3">
						{forums?.rows.length ? (
							[...forums.rows]
								.sort((a, b) => b.posts - a.posts)
								.slice(0, 6)
								.map((forum, index) => (
									<div
										key={forum.forumId}
										className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 text-sm"
									>
										<span className="text-xs text-basalt-muted-foreground tabular-nums">
											{String(index + 1).padStart(2, "0")}
										</span>
										<div className="min-w-0">
											<span className="block truncate" title={forum.forumName}>
												{forum.forumName}
											</span>
											<div
												aria-hidden="true"
												className="mt-1.5 h-1 overflow-hidden rounded-full bg-basalt-control"
											>
												<div
													className="h-full rounded-full bg-basalt-primary"
													style={{
														width: forumTotal > 0 ? `${(forum.posts / forumTotal) * 100}%` : "0%",
													}}
												/>
											</div>
										</div>
										<span className="text-right tabular-nums">
											{formatNumber(forum.posts)}
											<span className="ml-2 text-xs text-basalt-muted-foreground">
												{metricShare(forum.posts, forumTotal)}
											</span>
										</span>
									</div>
								))
						) : (
							<p className="py-6 text-center text-sm text-basalt-muted-foreground">
								{forums ? "该时段暂无版块帖子" : "版块分布暂不可用"}
							</p>
						)}
						<p className="border-t border-basalt-border/50 pt-3 text-xs text-basalt-muted-foreground">
							帖子含主题首帖。占比仅基于已统计版块，最多统计发帖前 50 个版块。
						</p>
					</LayerCard.Well>
				</LayerCard>
				<LayerCard>
					<LayerCard.Header className="flex items-center justify-between gap-2">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<LogIn className="h-4 w-4 text-basalt-primary" aria-hidden="true" />
							认证活动
						</h2>
						<Button asChild variant="ghost" size="sm">
							<Link href="/admin/analytics?tab=login">
								审计日志 <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</Button>
					</LayerCard.Header>
					<LayerCard.Well className="flex flex-1 flex-col justify-between">
						<dl className="grid grid-cols-2 gap-4 text-sm">
							{[
								["登录尝试", logins?.loginAttempts],
								["注册尝试", logins?.registerAttempts],
								["认证成功", logins?.successAttempts],
								["认证失败", logins?.failedAttempts],
							].map(([label, value]) => (
								<div key={label}>
									<dt className="text-xs text-basalt-muted-foreground">{label}</dt>
									<dd className="mt-1 text-xl font-semibold tabular-nums">
										{typeof value === "number" ? formatNumber(value) : "—"}
									</dd>
								</div>
							))}
						</dl>
						<p className="mt-4 border-t border-basalt-border/50 pt-3 text-xs text-basalt-muted-foreground">
							今日登录与注册尝试，按上海时区统计。成功率以全部认证尝试为分母。
						</p>
					</LayerCard.Well>
				</LayerCard>
			</div>
		</div>
	);
}
