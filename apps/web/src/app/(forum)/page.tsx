import { ForumGroup } from "@/components/forum/forum-group";
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
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">论坛首页</h1>
				<p className="mt-1 text-sm text-muted-foreground">浏览所有版块，参与讨论</p>
			</div>

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}

			{!error && tree.length === 0 && (
				<div className="rounded-[14px] bg-card p-8 text-center text-sm text-muted-foreground">
					暂无版块
				</div>
			)}
		</div>
	);
}
