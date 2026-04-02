import { DigestShowcase } from "@/components/forum/digest-showcase";
import { ForumGroup } from "@/components/forum/forum-group";
import { HomeFooter } from "@/components/forum/home-footer";
import { loadDigestList } from "@/viewmodels/forum/digest.server";
import { buildHomeFooterViewModel } from "@/viewmodels/forum/footer";
import { loadForumList } from "@/viewmodels/forum/forum-list.server";
import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";
import { loadSiteStats } from "@/viewmodels/forum/stats.server";
import type { ForumTreeNode } from "@ellie/types";

export default async function ForumHomePage() {
	let tree: ForumTreeNode[] = [];
	let error: string | null = null;

	// Fetch forum list, online stats, digest threads, and settings in parallel
	const [forumResult, statsResult, digestResult, settings] = await Promise.all([
		loadForumList().then(
			(r) => ({ status: "fulfilled" as const, value: r }),
			(r) => ({ status: "rejected" as const, reason: r }),
		),
		loadSiteStats().then(
			(r) => ({ status: "fulfilled" as const, value: r }),
			() => ({ status: "rejected" as const, reason: null }),
		),
		loadDigestList({ limit: 8 }).then(
			(r) => ({ status: "fulfilled" as const, value: r }),
			() => ({ status: "rejected" as const, reason: null }),
		),
		fetchPublicSettings(),
	]);

	if (forumResult.status === "fulfilled") {
		tree = forumResult.value;
	} else {
		error =
			forumResult.reason instanceof Error ? forumResult.reason.message : "Failed to load forums";
	}

	// Build footer with real online stats (graceful fallback on failure)
	const onlineStats =
		statsResult.status === "fulfilled"
			? {
					totalOnline: statsResult.value.totalOnline,
					peakOnline: statsResult.value.peakOnline,
					peakDate: statsResult.value.peakDate,
				}
			: undefined;

	// Digest threads for showcase (graceful fallback)
	const digestThreads = digestResult.status === "fulfilled" ? digestResult.value.results.items : [];
	const digestTotal = digestResult.status === "fulfilled" ? digestResult.value.stats.total : 0;

	return (
		<div className="space-y-4">
			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{/* Digest showcase — at the top */}
			<DigestShowcase threads={digestThreads} total={digestTotal} />

			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}

			{!error && tree.length === 0 && (
				<div className="rounded-lg bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
					暂无版块
				</div>
			)}

			{/* Homepage-only footer: online stats + friend links */}
			<HomeFooter vm={buildHomeFooterViewModel(settings, onlineStats)} />
		</div>
	);
}
