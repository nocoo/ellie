import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-cache", () => ({ getCachedPostsPerPage: vi.fn(async () => 20) }));
vi.mock("@/viewmodels/forum/thread-list.server", () => ({ loadThreadListPaged: vi.fn() }));
vi.mock("@/viewmodels/forum/title.server", () => ({ getForumTitle: vi.fn() }));

import ForumThreadsPage from "@/app/(forum)/forums/[id]/page";
import { ForumRecommendedCard } from "@/components/forum/forum-recommended-card";
import { ThreadTypeFilter } from "@/components/forum/thread-type-filter";
import { loadThreadListPaged } from "@/viewmodels/forum/thread-list.server";

const base = {
	forum: null,
	forums: [],
	items: [],
	page: 1,
	pages: 1,
	total: 0,
	limit: 20,
	breadcrumbs: [],
	hasNext: false,
	user: null,
	typeId: null,
	threadTypes: null,
	recommended: [],
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(loadThreadListPaged).mockResolvedValue(base);
});
function page() {
	return ForumThreadsPage({
		params: Promise.resolve({ id: "114" }),
	});
}
function nodes(node: ReactNode): React.ReactElement[] {
	return Children.toArray(node).flatMap((child) =>
		isValidElement<{ children?: ReactNode }>(child) ? [child, ...nodes(child.props.children)] : [],
	);
}
it("loads the entire page through the shared context model", async () => {
	const result = await page();
	expect(loadThreadListPaged).toHaveBeenCalledExactlyOnceWith(114);
	const card = nodes(result).find((n) => n.type === ForumRecommendedCard);
	expect(card?.props).toMatchObject({ threads: [] });
});
it("uses Worker-normalized type selection for filter UI", async () => {
	vi.mocked(loadThreadListPaged).mockResolvedValue({
		...base,
		typeId: 4,
		threadTypes: {
			enabled: true,
			required: false,
			listable: true,
			prefix: true,
			types: [
				{ id: 4, name: "Type", displayOrder: 0, icon: "", enabled: true, moderatorOnly: false },
			],
		},
	});
	const result = await page();
	expect(nodes(result).find((n) => n.type === ThreadTypeFilter)?.props).toMatchObject({
		activeTypeId: 4,
	});
});
it("renders errors without separately loading decorative data", async () => {
	vi.mocked(loadThreadListPaged).mockRejectedValue(new Error("denied"));
	const result = await page();
	expect(JSON.stringify(result)).toContain("denied");
	expect(loadThreadListPaged).toHaveBeenCalledOnce();
});
