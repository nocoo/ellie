// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DigestShowcase } from "@/components/forum/digest-showcase";
import { RecentShowcase } from "@/components/forum/recent-showcase";
import { buildDigestShowcaseItem, buildRecentShowcaseItem } from "@/viewmodels/forum/home-showcase";

vi.mock("next/link", () => ({
	default: ({ href, children }: any) => createElement("a", { href }, children),
}));
vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: ({ userId, avatarPath, className }: any) =>
		createElement("span", {
			"data-testid": "avatar",
			"data-user-id": userId,
			"data-path": avatarPath,
			className,
		}),
}));
vi.mock("@/viewmodels/shared/formatting", () => ({
	formatRelativeTime: (at: number) => `time:${at}`,
}));
afterEach(cleanup);
const digest = {
	id: 1,
	forumId: 2,
	forumName: "Forum",
	subject: "Digest topic",
	digest: 2,
	createdAt: 100,
	replies: 12,
	views: 34,
	anonymousAuthor: 0 as const,
	authorId: 3,
	authorName: "Alice",
	authorAvatarPath: "alice.png",
};
const recent = {
	id: 4,
	forumId: 2,
	forumName: "Forum",
	subject: "Recent topic",
	lastPostAt: 200,
	replies: 8,
	lastPosterId: 5,
	lastPoster: "Bob",
	lastPosterAvatarPath: "bob.png",
	anonymousLastPoster: 0 as const,
};

describe("homepage shared showcase", () => {
	it("uses the same two-line item, unchanged spacing, and cached profile fields for both lists", () => {
		render(createElement(DigestShowcase, { threads: [digest] }));
		render(createElement(RecentShowcase, { threads: [recent] }));
		for (const row of screen.getAllByTestId("home-showcase-item")) {
			expect(row.children).toHaveLength(2);
			expect(row.className).toBe("space-y-1 py-2.5");
		}
		const avatars = screen.getAllByTestId("avatar");
		expect(avatars.map((el) => el.getAttribute("data-path"))).toEqual(["alice.png", "bob.png"]);
		expect(avatars[0].parentElement?.getAttribute("href")).toBe("/users/3");
		expect(avatars[1].parentElement?.getAttribute("href")).toBe("/users/5");
		expect(avatars[0].nextElementSibling?.textContent).toBe("Alice");
		expect(screen.getByText("time:100")).toBeTruthy();
		expect(screen.getByText("time:200")).toBeTruthy();
		expect(screen.getAllByTitle("阅读量")).toHaveLength(1);
	});
	it("keeps equal-height keyboard-scrollable lists and includes seven topics", () => {
		render(
			createElement(DigestShowcase, {
				threads: Array.from({ length: 9 }, (_, id) => ({ ...digest, id })),
			}),
		);
		expect(screen.getAllByTestId("home-showcase-item")).toHaveLength(7);
		const region = screen.getByRole("region", { name: "精华推荐" });
		expect(region.className).toContain("h-76");
		expect(region.className).toContain("overflow-y-auto");
		expect(region.tabIndex).toBe(0);
	});
	it("shows empty placeholders without requesting profiles", () => {
		render(createElement(DigestShowcase, { threads: [] }));
		render(createElement(RecentShowcase, { threads: [] }));
		expect(screen.getByText("暂无可展示的讨论")).toBeTruthy();
		expect(screen.getByText("暂无精华主题，优质内容将在这里展示")).toBeTruthy();
		expect(screen.queryByTestId("avatar")).toBeNull();
	});
	it("masks anonymous identities even if a stale payload still contains profile fields", () => {
		const d = { ...digest, anonymousAuthor: 1 as const };
		const r = { ...recent, anonymousLastPoster: 1 as const };
		expect(buildDigestShowcaseItem(d)).toMatchObject({
			userId: 0,
			userName: "匿名",
			avatarPath: "",
		});
		expect(buildRecentShowcaseItem(r)).toMatchObject({
			userId: 0,
			userName: "匿名",
			avatarPath: "",
		});
		render(createElement(DigestShowcase, { threads: [d] }));
		render(createElement(RecentShowcase, { threads: [r] }));
		expect(screen.queryByTestId("avatar")).toBeNull();
		expect(screen.getAllByText("匿名")).toHaveLength(2);
	});
	it("labels deleted users without linking to user zero", () => {
		expect(buildDigestShowcaseItem({ ...digest, authorId: 0 }).userName).toBe("未知用户");
		expect(buildRecentShowcaseItem({ ...recent, lastPosterId: 0 }).userName).toBe("未知用户");
	});
});
