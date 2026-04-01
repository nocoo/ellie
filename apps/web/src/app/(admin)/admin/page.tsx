import { StatCard } from "@/components/admin/stat-card";
import { type DashboardStats, activeForums } from "@/viewmodels/admin/dashboard";
import { fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";
import { FileText, MessageSquare, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Quick links data
// ---------------------------------------------------------------------------

const QUICK_LINKS = [
	{ href: "/admin/users", label: "管理用户" },
	{ href: "/admin/forums", label: "管理版块" },
	{ href: "/admin/ip-bans", label: "IP 封禁" },
	{ href: "/admin/censor-words", label: "敏感词" },
];

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
	let stats: DashboardStats | null = null;
	let error: string | null = null;

	try {
		stats = await fetchDashboardStats();
	} catch (e) {
		error = e instanceof Error ? e.message : "仪表盘数据加载失败";
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">仪表盘</h1>
				<p className="mt-1 text-sm text-muted-foreground">论坛数据一览</p>
			</div>

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{stats && (
				<>
					{/* Stats Cards — 4 columns */}
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard label="用户总数" value={stats.users.total} icon={Users} />
						<StatCard label="主题总数" value={stats.threads.total} icon={FileText} />
						<StatCard label="今日发帖" value={stats.posts.today} icon={MessageSquare} />
						<StatCard label="活跃版块" value={activeForums(stats)} icon={MessagesSquare} />
					</div>

					{/* Detail Cards — 2x2 grid */}
					<div className="grid gap-4 sm:grid-cols-2">
						<StatCard
							label="用户"
							value={stats.users.total}
							icon={Users}
							subItems={[
								{ label: "今日", value: stats.users.today },
								{ label: "已封禁", value: stats.users.banned },
							]}
						/>
						<StatCard
							label="内容"
							value={stats.threads.total + stats.posts.total}
							icon={FileText}
							subItems={[
								{ label: "主题", value: stats.threads.total },
								{ label: "今日主题", value: stats.threads.today },
								{ label: "帖子", value: stats.posts.total },
								{ label: "今日帖子", value: stats.posts.today },
							]}
						/>
						<StatCard
							label="版块"
							value={stats.forums.total}
							icon={MessagesSquare}
							subItems={[{ label: "隐藏", value: stats.forums.hidden }]}
						/>

						{/* Quick Links */}
						<div className="rounded-xl border bg-card p-5">
							<p className="text-sm font-medium text-muted-foreground">快捷入口</p>
							<ul className="mt-3 space-y-2">
								{QUICK_LINKS.map((link) => (
									<li key={link.href}>
										<Link
											href={link.href}
											className="text-sm font-medium text-foreground hover:text-primary transition-colors"
										>
											{link.label} &rarr;
										</Link>
									</li>
								))}
							</ul>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
