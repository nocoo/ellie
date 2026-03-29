import { StatCard } from "@/components/admin/stat-card";
import { type DashboardStats, activeForums } from "@/viewmodels/admin/dashboard";
import { fetchDashboardStats } from "@/viewmodels/admin/dashboard.server";
import { FileText, MessageSquare, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Quick links data
// ---------------------------------------------------------------------------

const QUICK_LINKS = [
	{ href: "/admin/users", label: "Manage Users" },
	{ href: "/admin/forums", label: "Manage Forums" },
	{ href: "/admin/ip-bans", label: "IP Bans" },
	{ href: "/admin/censor-words", label: "Censor Words" },
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
		error = e instanceof Error ? e.message : "Failed to load dashboard stats";
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
				<p className="mt-1 text-sm text-muted-foreground">Overview of your forum at a glance.</p>
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
						<StatCard label="Total Users" value={stats.users.total} icon={Users} />
						<StatCard label="Total Threads" value={stats.threads.total} icon={FileText} />
						<StatCard label="Posts Today" value={stats.posts.today} icon={MessageSquare} />
						<StatCard label="Active Forums" value={activeForums(stats)} icon={MessagesSquare} />
					</div>

					{/* Detail Cards — 2x2 grid */}
					<div className="grid gap-4 sm:grid-cols-2">
						<StatCard
							label="Users"
							value={stats.users.total}
							icon={Users}
							subItems={[
								{ label: "Today", value: stats.users.today },
								{ label: "Banned", value: stats.users.banned },
							]}
						/>
						<StatCard
							label="Content"
							value={stats.threads.total + stats.posts.total}
							icon={FileText}
							subItems={[
								{ label: "Threads", value: stats.threads.total },
								{ label: "Threads Today", value: stats.threads.today },
								{ label: "Posts", value: stats.posts.total },
								{ label: "Posts Today", value: stats.posts.today },
							]}
						/>
						<StatCard
							label="Forums"
							value={stats.forums.total}
							icon={MessagesSquare}
							subItems={[{ label: "Hidden", value: stats.forums.hidden }]}
						/>

						{/* Quick Links */}
						<div className="rounded-xl border bg-card p-5">
							<p className="text-sm font-medium text-muted-foreground">Quick Links</p>
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
