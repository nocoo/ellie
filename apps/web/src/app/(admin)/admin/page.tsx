// Admin dashboard page — stats overview
// Ref: 04c §仪表盘 — stats cards + trend + recent items
//
// Server component: fetches dashboard data at request time.
// Displays: 4 stat cards, recent threads, recent users.

import type { DashboardData } from "@/viewmodels/admin/dashboard";
import { fetchDashboardData } from "@/viewmodels/admin/dashboard";
import { createRepositories } from "@ellie/repositories";

export default async function AdminDashboardPage() {
	const repos = createRepositories();
	const data: DashboardData = await fetchDashboardData(repos);

	return (
		<div className="space-y-6">
			<h2 className="text-2xl font-semibold">Dashboard</h2>

			{/* Stats cards */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard label="Total Users" value={data.stats.totalUsers} />
				<StatCard label="Total Posts" value={data.stats.totalPosts} />
				<StatCard label="Threads Today" value={data.stats.todayThreads} />
				<StatCard label="Active Today" value={data.stats.todayActiveUsers} />
			</div>

			{/* Recent items */}
			<div className="grid gap-6 lg:grid-cols-2">
				{/* Recent threads */}
				<div className="rounded-[14px] bg-card p-4">
					<h3 className="mb-3 text-sm font-medium text-muted-foreground">Recent Threads</h3>
					{data.recentThreads.length === 0 ? (
						<p className="text-sm text-muted-foreground">No recent threads.</p>
					) : (
						<ul className="space-y-2">
							{data.recentThreads.map((t) => (
								<li key={t.id} className="flex items-center justify-between text-sm">
									<span className="truncate">{t.subject}</span>
									<span className="shrink-0 text-muted-foreground">{t.authorName}</span>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* Recent users */}
				<div className="rounded-[14px] bg-card p-4">
					<h3 className="mb-3 text-sm font-medium text-muted-foreground">Recent Users</h3>
					{data.recentUsers.length === 0 ? (
						<p className="text-sm text-muted-foreground">No recent users.</p>
					) : (
						<ul className="space-y-2">
							{data.recentUsers.map((u) => (
								<li key={u.id} className="flex items-center justify-between text-sm">
									<span className="truncate">{u.username}</span>
									<span className="shrink-0 text-muted-foreground">{u.email}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

/** Simple stat card component */
function StatCard({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-[14px] bg-card p-4">
			<p className="text-sm text-muted-foreground">{label}</p>
			<p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
		</div>
	);
}
