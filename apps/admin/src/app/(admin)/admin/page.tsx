import { Button, LayerCard } from "@nocoo/basalt";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
	ArrowUpRight,
	BarChart3,
	FileText,
	Filter,
	Flag,
	Globe,
	LayoutDashboard,
	MessageSquare,
	MessagesSquare,
	ShieldBan,
	Users,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { DashboardActivity } from "@/components/admin/dashboard-activity";
import { StatCard } from "@/components/admin/stat-card";
import type { DashboardStats } from "@/viewmodels/admin/dashboard";
import { fetchDashboardActivity, fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";

const QUICK_LINKS = [
	{ href: "/admin/users", label: "管理用户", icon: Users },
	{ href: "/admin/threads", label: "管理主题", icon: FileText },
	{ href: "/admin/forums", label: "管理版块", icon: MessagesSquare },
	{ href: "/admin/reports", label: "处理举报", icon: Flag },
	{ href: "/admin/ip-bans", label: "IP 封禁", icon: ShieldBan },
	{ href: "/admin/censor-words", label: "敏感词", icon: Filter },
];

async function ActivitySection() {
	return <DashboardActivity activity={await fetchDashboardActivity()} />;
}

export default async function DashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ statistics?: string | string[] }>;
}) {
	const showStatistics = (await searchParams).statistics === "1";
	let stats: DashboardStats | null = null;
	let error: string | null = null;
	if (showStatistics) {
		try {
			stats = await fetchDashboardStats();
		} catch (e) {
			error = e instanceof Error ? e.message : "统计数据加载失败";
		}
	}

	return (
		<div className="space-y-5">
			<PageHeader
				title={
					<span className="flex items-center gap-2.5">
						<LayoutDashboard
							className="h-6 w-6 text-basalt-primary"
							aria-hidden="true"
							strokeWidth={1.5}
						/>
						仪表盘
					</span>
				}
				description="管理社区内容、用户和运行状态"
				actions={
					<>
						<Button asChild variant="outline" size="sm">
							<Link href="https://ellie.hexly.ai" target="_blank" rel="noopener noreferrer">
								<Globe className="h-4 w-4" aria-hidden="true" />
								查看论坛
								<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</Button>
						<Button asChild size="sm">
							<Link href="/admin/analytics" prefetch={false}>
								<BarChart3 className="h-4 w-4" aria-hidden="true" />
								数据分析
							</Link>
						</Button>
					</>
				}
			/>
			{error && <AdminInlineMessage variant="error" text={error} />}
			<LayerCard padding="sm" className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-basalt-muted-foreground">需要时再查看累计计数和社区活动。</p>
				<Button asChild variant="outline" size="sm">
					<Link href={showStatistics ? "/admin" : "/admin?statistics=1"} prefetch={false}>
						{showStatistics ? "收起统计" : "加载统计"}
					</Link>
				</Button>
			</LayerCard>
			{stats && (
				<section aria-label="累计计数" className="space-y-2">
					<div className="grid gap-3 sm:grid-cols-3">
						<StatCard label="累计用户" value={stats.users.total ?? "—"} icon={Users} />
						<StatCard label="累计主题" value={stats.threads.total ?? "—"} icon={FileText} />
						<StatCard label="累计帖子" value={stats.posts.total ?? "—"} icon={MessageSquare} />
					</div>
					<p className="text-xs text-basalt-muted-foreground">
						使用已维护的累计计数，每 30 分钟按需更新。缺失计数显示为 —。
						<Link href="/admin/statistics/calibrate" prefetch={false} className="ml-2 underline">
							统计校准
						</Link>
					</p>
				</section>
			)}

			{showStatistics && (
				<Suspense
					fallback={
						<LayerCard className="flex min-h-48 items-center justify-center gap-2">
							<Loader size={20} />
							<span role="status" className="text-sm text-basalt-muted-foreground">
								加载社区活动…
							</span>
						</LayerCard>
					}
				>
					<ActivitySection />
				</Suspense>
			)}

			<LayerCard padding="sm">
				<div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
					{QUICK_LINKS.map(({ href, label, icon: Icon }) => (
						<Button key={href} asChild variant="ghost" size="sm" className="justify-start gap-2">
							<Link href={href} prefetch={false}>
								<Icon className="h-4 w-4 text-basalt-muted-foreground" aria-hidden="true" />
								{label}
							</Link>
						</Button>
					))}
				</div>
			</LayerCard>
		</div>
	);
}
