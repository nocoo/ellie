import { formatNumber } from "@ellie/shared";
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
import { activeForums, type DashboardStats } from "@/viewmodels/admin/dashboard";
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

export default async function DashboardPage() {
	let stats: DashboardStats | null = null;
	let error: string | null = null;
	try {
		stats = await fetchDashboardStats();
	} catch (e) {
		error = e instanceof Error ? e.message : "仪表盘数据加载失败";
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
				description="掌握社区规模、内容增长与访问质量"
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
							<Link href="/admin/analytics">
								<BarChart3 className="h-4 w-4" aria-hidden="true" />
								数据分析
							</Link>
						</Button>
					</>
				}
			/>
			{error && <AdminInlineMessage variant="error" text={error} />}
			{stats && (
				<section aria-label="全站总览" className="space-y-2">
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<StatCard
							label="用户总数"
							value={stats.users.total}
							icon={Users}
							subItems={[
								{ label: "今日新增 · UTC", value: stats.users.today },
								{ label: "已封禁", value: stats.users.banned },
							]}
						/>
						<StatCard
							label="主题总数"
							value={stats.threads.total}
							icon={FileText}
							subItems={[{ label: "今日新增 · UTC", value: stats.threads.today }]}
						/>
						<StatCard
							label="帖子总数"
							value={stats.posts.total}
							icon={MessageSquare}
							subItems={[{ label: "今日发帖 · UTC", value: stats.posts.today }]}
						/>
						<StatCard
							label="版块总数"
							value={stats.forums.total}
							icon={MessagesSquare}
							subItems={[
								{ label: "可见版块", value: activeForums(stats) },
								{ label: "隐藏版块", value: stats.forums.hidden },
							]}
						/>
					</div>
					<p className="text-right text-xs text-basalt-muted-foreground tabular-nums">
						内容记录共 {formatNumber(stats.threads.total + stats.posts.total)} 条 · 主题与帖子合计
					</p>
				</section>
			)}

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

			<LayerCard padding="sm">
				<div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
					{QUICK_LINKS.map(({ href, label, icon: Icon }) => (
						<Button key={href} asChild variant="ghost" size="sm" className="justify-start gap-2">
							<Link href={href}>
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
