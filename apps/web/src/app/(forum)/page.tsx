import type { ForumTreeNode } from "@ellie/types";
import { Button } from "@nocoo/basalt/components/button";
import { CalendarCheck } from "@nocoo/basalt/icons";
import Link from "next/link";
import { DigestShowcase } from "@/components/forum/digest-showcase";
import { ForumGroup } from "@/components/forum/forum-group";
import { HomeFooter } from "@/components/forum/home-footer";
import { RecentShowcase } from "@/components/forum/recent-showcase";
import { getCachedHomeContext } from "@/lib/forum-cache";
import { buildHomeFooterViewModel } from "@/viewmodels/forum/footer";
import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";

export default async function ForumHomePage() {
	let tree: ForumTreeNode[] = [];
	let error: string | null = null;

	const [home, settings] = await Promise.all([
		getCachedHomeContext().then(
			(value) => ({ value, error: null }),
			(reason: unknown) => ({
				value: null,
				error: reason instanceof Error ? reason.message : "Failed to load forums",
			}),
		),
		fetchPublicSettings(),
	]);
	tree = home.value?.tree ?? [];
	error = home.error;
	const onlineStats = home.value?.stats;
	const digestThreads = home.value?.digest ?? [];

	return (
		<div className="space-y-4">
			<nav
				aria-label="版块分区"
				className="flex min-w-0 items-center justify-between gap-2 text-xs"
				data-home-sections
			>
				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{tree.map((group) => (
						<a
							key={group.id}
							href={`#forum-group-${group.id}`}
							className="shrink-0 rounded-lg border border-basalt-border bg-basalt-card px-3 py-2 text-basalt-muted-foreground hover:border-basalt-primary/40 hover:text-basalt-primary"
						>
							{group.name}
						</a>
					))}
				</div>
				<Button asChild className="shrink-0">
					<Link href="/checkin" prefetch={false}>
						<CalendarCheck className="size-4" aria-hidden="true" />
						每日签到
					</Link>
				</Button>
			</nav>
			{error && (
				<div className="rounded-lg border border-basalt-destructive/50 bg-basalt-destructive/10 p-4 text-sm text-basalt-destructive">
					{error}
				</div>
			)}

			<div className="grid gap-4 lg:grid-cols-2">
				<DigestShowcase threads={digestThreads} />
				<RecentShowcase threads={home.value?.recent ?? []} />
			</div>

			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}

			{!error && tree.length === 0 && (
				<div className="rounded-lg bg-basalt-card p-8 text-center text-sm text-basalt-muted-foreground ring-1 ring-basalt-border">
					暂无版块
				</div>
			)}

			{/* Homepage-only footer: online stats + friend links */}
			<HomeFooter vm={buildHomeFooterViewModel(settings, onlineStats)} />
		</div>
	);
}
