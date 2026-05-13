// ThreadDetailHeader DOM tests — Phase H.3.
//
// Pure helpers (`buildForumBreadcrumb`, badge variants, labels) already
// have unit coverage. This file exists to pin the runtime DOM contract for
// the admin thread detail header — the three visible signals the reviewer
// called out as the core risk surface:
//
//   1. Forum breadcrumb chain renders root-first; intermediate nodes link
//      to /admin/forums/<id>; the current forum is plain text. Missing
//      parents gracefully degrade to a partial / fallback chain instead
//      of crashing.
//   2. Highlight badge appears iff `thread.highlight > 0`, with parity to
//      the list-row badge.
//   3. `lastPoster` renders as an anchor when `lastPosterId > 0` and as
//      plain text otherwise. The whole last-reply line is suppressed
//      entirely when there is no reply yet (`lastPostAt === 0`).

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadDetailHeader } from "@/components/admin/thread-detail-header";
import type { Forum } from "@/viewmodels/admin/forums";
import type { Thread } from "@/viewmodels/admin/threads";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
	cleanup();
});

// next/link is rendered through @testing-library — happy-dom + react treat
// it as a plain anchor, so we can assert href via `getAttribute("href")`.

function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: 100,
		subject: "测试主题",
		forumId: 3,
		authorId: 7,
		authorName: "alice",
		authorAvatar: "",
		authorAvatarPath: "",
		replies: 12,
		views: 345,
		sticky: 0,
		closed: 0,
		digest: 0,
		highlight: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		createdAt: 1_700_000_000,
		typeName: "",
		special: 0,
		recommends: 0,
		isAuthorFirstThread: false,
		...overrides,
	};
}

const FORUMS: Forum[] = [
	{
		id: 1,
		parentId: 0,
		name: "技术区",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: "group",
		status: 1,
		moderators: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastThreadSubject: "",
	},
	{
		id: 2,
		parentId: 1,
		name: "前端",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: "forum",
		status: 1,
		moderators: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastThreadSubject: "",
	},
	{
		id: 3,
		parentId: 2,
		name: "React",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: "sub",
		status: 1,
		moderators: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastThreadSubject: "",
	},
];

describe("ThreadDetailHeader — Phase H.3", () => {
	describe("forum breadcrumb", () => {
		it("renders the full chain root-first, with non-last segments as links", () => {
			const thread = makeThread({ forumId: 3 });
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			const nav = screen.getByRole("navigation", { name: "版块路径" });
			// All three names appear in order: 技术区 / 前端 / React.
			const text = nav.textContent ?? "";
			const idxRoot = text.indexOf("技术区");
			const idxMid = text.indexOf("前端");
			const idxLast = text.indexOf("React");
			expect(idxRoot).toBeGreaterThanOrEqual(0);
			expect(idxMid).toBeGreaterThan(idxRoot);
			expect(idxLast).toBeGreaterThan(idxMid);
			// H.3.1: non-last segments link into the threads list filtered by
			// that forum (admin doesn't have per-forum detail routes). Last
			// segment is plain text — the "you are here" anchor.
			expect(screen.getByRole("link", { name: "技术区" }).getAttribute("href")).toBe(
				"/admin/threads?forumId=1",
			);
			expect(screen.getByRole("link", { name: "前端" }).getAttribute("href")).toBe(
				"/admin/threads?forumId=2",
			);
			expect(screen.queryByRole("link", { name: "React" })).toBeNull();
			// Defensive: there must be NO `/admin/forums/<id>` href in the
			// breadcrumb anywhere — those routes don't exist (H.3 regression
			// pin from reviewer).
			for (const link of screen.getAllByRole("link")) {
				expect(link.getAttribute("href")).not.toMatch(/^\/admin\/forums\/\d+/);
			}
		});

		it('falls back to "#<id>" when the current forum is unknown', () => {
			const thread = makeThread({ forumId: 99 });
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			const nav = screen.getByRole("navigation", { name: "版块路径" });
			expect(nav.textContent).toContain("#99");
			// Fallback is plain text — no link for it.
			expect(screen.queryByRole("link", { name: "#99" })).toBeNull();
		});

		it("renders a partial chain when the parent chain breaks mid-walk", () => {
			// React's parent (id=2) is missing — only React should render.
			const partial = [FORUMS[0], FORUMS[2]];
			const thread = makeThread({ forumId: 3 });
			render(
				<ThreadDetailHeader thread={thread} forums={partial} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			const nav = screen.getByRole("navigation", { name: "版块路径" });
			expect(nav.textContent).toContain("React");
			expect(nav.textContent).not.toContain("前端");
		});
	});

	describe("highlight badge", () => {
		it("does NOT render the highlight badge when highlight === 0", () => {
			const thread = makeThread({ highlight: 0 });
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			expect(screen.queryByText("高亮")).toBeNull();
		});

		it("renders the highlight badge when highlight > 0 (encoded bitmask)", () => {
			// Real-world value is a packed 24-bit RGB; any non-zero number
			// must produce the badge — variant logic only differentiates
			// "set vs unset".
			const thread = makeThread({ highlight: 0xff0000 });
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			expect(screen.getByText("高亮")).not.toBeNull();
		});
	});

	describe("last-poster line", () => {
		it("is suppressed entirely when the thread has no reply yet", () => {
			const thread = makeThread({ lastPostAt: 0, lastPoster: "", lastPosterId: 0 });
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			expect(screen.queryByText(/最后回复/)).toBeNull();
		});

		it("renders lastPoster as a link when lastPosterId > 0", () => {
			const thread = makeThread({
				lastPostAt: 1_700_001_000,
				lastPoster: "bob",
				lastPosterId: 42,
			});
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			const link = screen.getByRole("link", { name: "bob" });
			expect(link.getAttribute("href")).toBe("/admin/users/42");
		});

		it("renders lastPoster as plain text when lastPosterId === 0", () => {
			const thread = makeThread({
				lastPostAt: 1_700_001_000,
				lastPoster: "ghost",
				lastPosterId: 0,
			});
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			// Name is present, but not a link.
			expect(screen.queryByRole("link", { name: "ghost" })).toBeNull();
			// Use a function matcher because the name is wrapped inside the
			// "最后回复: ghost · ..." line (text is split across nodes).
			const matches = screen.getAllByText((_content, node) => {
				if (!node) return false;
				const txt = node.textContent ?? "";
				return txt.includes("最后回复") && txt.includes("ghost");
			});
			expect(matches.length).toBeGreaterThan(0);
		});
	});

	describe("structural meta chips", () => {
		it("groups typeName / special / recommends / isAuthorFirstThread when present", () => {
			const thread = makeThread({
				typeName: "公告",
				special: 1,
				recommends: 5,
				isAuthorFirstThread: true,
			});
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			expect(screen.getByText("公告")).not.toBeNull();
			expect(screen.getByText("special=1")).not.toBeNull();
			expect(screen.getByText(/推荐\s*5/)).not.toBeNull();
			expect(screen.getByText("作者首帖")).not.toBeNull();
		});

		it("hides the meta-chip row entirely when no chip applies", () => {
			const thread = makeThread();
			render(
				<ThreadDetailHeader thread={thread} forums={FORUMS} onEdit={vi.fn()} onDelete={vi.fn()} />,
			);
			expect(screen.queryByText("作者首帖")).toBeNull();
			expect(screen.queryByText(/special=/)).toBeNull();
		});
	});
});
