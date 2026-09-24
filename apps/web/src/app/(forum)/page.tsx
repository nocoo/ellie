import type { ForumTreeNode } from "@ellie/types";
import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { DigestShowcase } from "@/components/forum/digest-showcase";
import { ForumGroup } from "@/components/forum/forum-group";
import { HomeFooter } from "@/components/forum/home-footer";
import { Button } from "@/components/ui/button";
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
				className="flex flex-wrap items-center gap-2 text-xs"
				data-home-sections
			>
				{tree.length > 0 && (
					<span className="mr-1 text-muted-foreground">{tree.length} 个分区</span>
				)}
				{tree.map((group) => (
					<a
						key={group.id}
						href={`#forum-group-${group.id}`}
						className="rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground hover:border-primary/40 hover:text-primary"
					>
						{group.name}
					</a>
				))}
				<Button className="ml-auto" nativeButton={false} render={<Link href="/checkin" />}>
					<CalendarCheck className="size-4" aria-hidden="true" />
					每日签到
				</Button>
			</nav>
			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{/* Digest showcase — at the top */}
			<DigestShowcase threads={digestThreads} />

			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}

			{!error && tree.length === 0 && (
				<div className="rounded-lg bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-border">
					暂无版块
				</div>
			)}

			{/* Homepage-only footer: online stats + friend links */}
			<HomeFooter vm={buildHomeFooterViewModel(settings, onlineStats)} />
		</div>
	);
}
