import type { ThreadDetailContextData, ThreadDetailDisplay } from "@ellie/types";
import { beforeEach, expect, it, vi } from "vitest";
import { loadThreadDetail } from "@/viewmodels/forum/thread-detail.server";

const mocks = vi.hoisted(() => ({ context: vi.fn(), record: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-ellie-prefetch": "1" }) }));
vi.mock("@/lib/forum-cache", () => ({
	getCachedThreadContext: mocks.context,
	recordThreadView: mocks.record,
}));
vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: async () => ({}),
	getStr: (_: unknown, __: unknown, fallback: string) => fallback,
}));

function context(extra = {}): ThreadDetailContextData & { display: ThreadDetailDisplay } {
	return {
		thread: {
			id: 1,
			forumId: 10,
			subject: "Hello",
			authorId: 100,
			authorName: "Alice",
			views: 5,
			replies: 1,
			createdAt: 900,
			sticky: 0,
			closed: 0,
		},
		user: null,
		revision: "a".repeat(64),
		cacheable: true,
		nextCursor: "next",
		display: {
			forum: {
				id: 10,
				parentId: 0,
				name: "General",
				status: 1,
				visibility: "public",
				type: "forum",
				moderators: "mod1",
				moderatorIds: "101",
				moderatorList: [],
			},
			ancestors: [{ id: 2, name: "Category" }],
			authors: [],
			posts: [
				{
					id: 200,
					threadId: 1,
					authorId: 100,
					authorName: "Alice",
					content: "<p>Hello</p>",
					createdAt: 900,
					position: 1,
					first: 1,
				},
			],
			attachments: [
				{ id: 3, postId: 200, threadId: 1, authorId: 100, filename: "file.png", isImage: true },
			],
		},
		...extra,
	} as ThreadDetailContextData & { display: ThreadDetailDisplay };
}
const member = {
	id: 100,
	username: "Alice",
	role: 0,
	status: 0,
	credits: 5,
	coins: 3,
	groupTitle: "Member",
	email: "test@example.com",
	emailVerifiedAt: 7,
	emailChangedAt: 8,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(context());
});

it("assembles bodies, attachment groups, cursor and breadcrumbs from one authorized context", async () => {
	const data = await loadThreadDetail({ threadId: 1 });
	expect(mocks.context).toHaveBeenCalledOnce();
	expect(data.thread?.views).toBe(5);
	expect(data.posts).toHaveLength(1);
	expect(data.posts[0].attachments[0].id).toBe(3);
	expect(data.posts[0].comments).toBeUndefined();
	expect(data.nextCursor).toBe("next");
	expect(data.prevCursor).toBeNull();
	expect(data.breadcrumbs.map((item) => item.label)).toEqual([
		"同济网论坛",
		"Category",
		"General",
		"Hello",
	]);
	expect(data.currentUser).toBeNull();
	expect(data.canEditSubject).toBe(false);
	expect(data.canManageThread).toBe(false);
	expect(data.canDeleteThread).toBe(false);
	expect(mocks.record).not.toHaveBeenCalled();
});

it("uses fresh Worker user fields for author permissions and email verification", async () => {
	mocks.context.mockResolvedValue(context({ user: member }));
	const data = await loadThreadDetail({ threadId: 1 });
	expect(data.currentUser).toMatchObject(member);
	expect(data.canEditSubject).toBe(true);
	expect(data.canManageThread).toBe(false);
	expect(data.canDeleteThread).toBe(false);
	expect(data.posts[0].canEdit).toBe(true);
});

it.each([
	[1, true, true],
	[2, true, true],
	[3, true, false],
	[0, false, false],
])(
	"uses current role %s for moderation and the existing delete UI policy",
	async (role, moderate, move) => {
		mocks.context.mockResolvedValue(
			context({ user: { ...member, id: 101, username: "mod1", role } }),
		);
		const data = await loadThreadDetail({ threadId: 1 });
		expect(data.canModerateForum).toBe(moderate);
		expect(data.canManageThread).toBe(moderate);
		expect(data.canMoveThread).toBe(move);
		expect(data.canDeleteThread).toBe(move);
	},
);

it("does not expose edit permissions after closing the thread or masking its owner", async () => {
	for (const thread of [
		{ ...context().thread, closed: 1 },
		{ ...context().thread, authorId: 0, anonymousAuthor: 1 },
	]) {
		mocks.context.mockResolvedValue(context({ thread, user: member }));
		expect((await loadThreadDetail({ threadId: 1 })).canEditSubject).toBe(false);
	}
});

it("propagates denied context and rejects a route mismatch before recording views", async () => {
	await expect(loadThreadDetail({ threadId: 2 })).rejects.toThrow("mismatch");
	mocks.context.mockRejectedValueOnce(new Error("Forbidden"));
	await expect(loadThreadDetail({ threadId: 1 })).rejects.toThrow("Forbidden");
	expect(mocks.record).not.toHaveBeenCalled();
});

it("maps returned public authors for post enrichment", async () => {
	const data = context();
	data.display.authors = [{ id: 100, username: "Alice", role: 0, status: 0 }] as NonNullable<
		ThreadDetailContextData["display"]
	>["authors"];
	mocks.context.mockResolvedValue(data);
	expect((await loadThreadDetail({ threadId: 1 })).posts[0].author?.username).toBe("Alice");
});

it("preserves the readable thread when no visible forum breadcrumb context exists", async () => {
	const data = context();
	data.display.forum = null;
	data.display.ancestors = [];
	mocks.context.mockResolvedValue(data);
	const page = await loadThreadDetail({ threadId: 1 });
	expect(page.forum).toBeNull();
	expect(page.canModerateForum).toBe(false);
	expect(page.canManageThread).toBe(false);
	expect(page.canEditSubject).toBe(false);
	expect(page.breadcrumbs.map((item) => item.label)).toEqual(["同济网论坛", "版块", "Hello"]);
});
