// (forum)/page.tsx — Forum home page (forum list)
// Ref: 04d §论坛首页 — Grouped forum list

import { ForumGroup } from "@/components/forum/forum-group";
import { fetchForumList } from "@/viewmodels/forum/forum-list";
import { createRepositories } from "@ellie/repositories";

/**
 * Forum homepage — displays grouped forum list.
 *
 * Server component: fetches data at request time (mock phase).
 * Phase 2: Will use ISR/streaming for real D1 data.
 */
export default async function ForumHomePage() {
	const repos = createRepositories();
	const { tree } = await fetchForumList(repos);

	return (
		<div className="space-y-4">
			{tree.map((group) => (
				<ForumGroup key={group.id} group={group} />
			))}
			{tree.length === 0 && (
				<div className="rounded-[14px] bg-card p-6 text-center text-muted-foreground">
					No forums available.
				</div>
			)}
		</div>
	);
}
