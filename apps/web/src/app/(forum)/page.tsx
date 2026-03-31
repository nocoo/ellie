import { ForumGroup } from "@/components/forum/forum-group";
import { HomeFooter } from "@/components/forum/home-footer";
import { loadForumList } from "@/viewmodels/forum/forum-list.server";
import type { ForumTreeNode } from "@ellie/types";

export default async function ForumHomePage() {
	let tree: ForumTreeNode[] = [];
	let error: string | null = null;

	try {
		tree = await loadForumList();
	} catch (e) {
		error = e instanceof Error ? e.message : "Failed to load forums";
	}

	return (
		<div className="space-y-4">
			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}

			{!error && tree.length === 0 && (
				<div className="rounded-lg bg-card p-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
					暂无版块
				</div>
			)}

			{/* Homepage-only footer: online stats + friend links */}
			<HomeFooter />
		</div>
	);
}
