// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: async () => ({}),
	getStr: (_settings: unknown, _key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/forum-cache", () => ({ getCachedPostsPerPage: async () => 20 }));
vi.mock("@/components/forum/user-popover", () => ({
	UserPopover: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/forum/user-avatar", () => ({ ForumAvatar: () => null }));

import SearchPage from "@/app/(forum)/search/page";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it("does not claim zero matches on a populated cursor page", async () => {
	vi.stubEnv("WORKER_API_URL", "https://review.invalid");
	vi.stubEnv("FORUM_API_KEY", "private-review-fixture-key");
	const requests: string[] = [];
	const cursor = btoa(JSON.stringify({ lastPostAt: 1_700_000_000, id: 42 }));
	const thread = {
		id: 42,
		forumId: 5,
		authorId: 0,
		authorName: "",
		anonymousAuthor: 1,
		subject: "校园生活搜索结果",
		createdAt: 1_700_000_000,
		lastPostAt: 1_700_000_100,
		lastPoster: "",
		lastPosterId: 0,
		replies: 25,
		views: 100,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const url = new URL(input);
			requests.push(url.pathname + url.search);
			if (url.pathname === "/api/v1/settings") {
				return Response.json({ data: { "general.search.enabled": true }, meta: {} });
			}
			expect(url.pathname).toBe("/api/v1/search/threads");
			// Exact Worker contract: the count query runs only on the first page.
			const laterPage = url.searchParams.has("cursor");
			return Response.json({
				data: [{ ...thread, id: laterPage ? 41 : 42 }],
				meta: { total: laterPage ? 0 : 41, nextCursor: laterPage ? null : cursor },
			});
		}),
	);

	const first = render(await SearchPage({ searchParams: Promise.resolve({ q: "校园" }) }));
	expect(first.container.textContent).toContain("找到 41 条相关主题");
	const next = first.container.querySelector<HTMLAnchorElement>('a[href*="cursor="]');
	expect(next).not.toBeNull();
	if (!next) throw new Error("Next search page link is missing");
	const nextUrl = new URL(next.href, "https://review.invalid");
	first.unmount();

	const later = render(
		await SearchPage({
			searchParams: Promise.resolve({
				q: nextUrl.searchParams.get("q") ?? undefined,
				cursor: nextUrl.searchParams.get("cursor") ?? undefined,
			}),
		}),
	);
	expect(screen.getAllByText(thread.subject).length).toBeGreaterThan(0);
	expect(requests.filter((url) => url.startsWith("/api/v1/search/threads"))).toHaveLength(2);
	expect(later.container.textContent).not.toContain("找到 0 条相关主题");
	expect(later.container.textContent).not.toContain("共 0 条结果");
	expect(later.container.textContent).toContain("本页显示 1 条相关主题");
});
