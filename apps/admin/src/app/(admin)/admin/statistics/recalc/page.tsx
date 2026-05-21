"use client";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { STATISTICS_DONE_VARIANT } from "@/viewmodels/admin/badges";
import { Badge } from "@ellie/ui";
import { Button } from "@ellie/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ellie/ui";
import { CheckCircle, Database, Loader2, MessageSquare, Users } from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecalcTask {
	key: string;
	title: string;
	description: string;
	icon: React.ReactNode;
	endpoint: string;
	body?: Record<string, unknown>;
}

interface RecalcResult {
	updated?: number;
	forumId?: number | null;
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

const RECALC_TASKS: RecalcTask[] = [
	{
		key: "forums",
		title: "版块统计",
		description: "重新计算所有版块的主题数、帖子数和最后活动信息",
		icon: <Database className="h-5 w-5" />,
		endpoint: "/api/admin/statistics/recalc-forums",
	},
	{
		key: "threads",
		title: "主题统计",
		description: "重新计算所有主题的回复数和最后回复信息",
		icon: <MessageSquare className="h-5 w-5" />,
		endpoint: "/api/admin/statistics/recalc-threads",
	},
	{
		key: "users",
		title: "用户统计",
		description: "重新计算所有用户的主题数、回帖数和精华帖数",
		icon: <Users className="h-5 w-5" />,
		endpoint: "/api/admin/statistics/recalc-users",
	},
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function StatisticsPage() {
	const [runningTask, setRunningTask] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, RecalcResult | null>>({});
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		task: RecalcTask | null;
	}>({ open: false, task: null });

	const handleRunTask = useCallback(async (task: RecalcTask) => {
		setRunningTask(task.key);
		setResults((prev) => ({ ...prev, [task.key]: null }));

		try {
			const res = await fetch(task.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: task.body ? JSON.stringify(task.body) : undefined,
			});
			const json = await res.json();
			// API returns { data: { updated: ... }, meta: { ... } }
			setResults((prev) => ({ ...prev, [task.key]: json.data ?? json }));
		} catch {
			setResults((prev) => ({ ...prev, [task.key]: { updated: -1 } }));
		} finally {
			setRunningTask(null);
			setConfirmDialog({ open: false, task: null });
		}
	}, []);

	const openConfirm = useCallback((task: RecalcTask) => {
		setConfirmDialog({ open: true, task });
	}, []);

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader
				title="统计计算"
				subtitle="重新计算数据库中的统计数据。当数据迁移或批量操作后出现统计不准确时使用。"
			/>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{RECALC_TASKS.map((task) => {
					const isRunning = runningTask === task.key;
					const result = results[task.key];
					const hasResult = result !== undefined && result !== null;

					return (
						<Card key={task.key}>
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
											{task.icon}
										</div>
										<CardTitle className="text-base">{task.title}</CardTitle>
									</div>
									{hasResult && result.updated !== -1 && (
										<Badge variant={STATISTICS_DONE_VARIANT}>
											<CheckCircle className="mr-1 h-3 w-3" />
											完成
										</Badge>
									)}
								</div>
								<CardDescription className="text-xs">{task.description}</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="flex items-center justify-between">
									<Button
										variant="outline"
										size="sm"
										onClick={() => openConfirm(task)}
										disabled={runningTask !== null}
									>
										{isRunning ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												计算中...
											</>
										) : (
											"开始计算"
										)}
									</Button>
									{hasResult && (
										<span className="text-xs text-muted-foreground">
											{result.updated === -1 ? "执行失败" : `已更新 ${result.updated} 条记录`}
										</span>
									)}
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">说明</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground space-y-2">
					<p>
						<strong>版块统计</strong>：计算每个版块的主题数量、帖子数量，以及最后发帖信息（最后主题
						ID、最后发帖时间、最后发帖人）。
					</p>
					<p>
						<strong>主题统计</strong>
						：计算每个主题的回复数量，以及最后回复信息（最后回复时间、最后回复人）。
					</p>
					<p>
						<strong>用户统计</strong>：计算每个用户的发帖数、回帖数和精华帖数。
					</p>
					<p className="text-xs">
						注意：这些操作可能需要一些时间，具体取决于数据量大小。建议在低峰期执行。
					</p>
				</CardContent>
			</Card>

			<AdminConfirmDialog
				open={confirmDialog.open}
				onOpenChange={(open) => setConfirmDialog((d) => ({ ...d, open }))}
				title={`重新计算${confirmDialog.task?.title ?? ""}`}
				description={`确定要重新计算${confirmDialog.task?.title ?? ""}吗？这将覆盖现有的统计数据。`}
				variant="default"
				confirmLabel="开始计算"
				loading={runningTask !== null}
				onConfirm={() => confirmDialog.task && handleRunTask(confirmDialog.task)}
			/>
		</div>
	);
}
