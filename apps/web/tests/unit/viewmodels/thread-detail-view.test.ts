// Doc/29 view counting at the successful thread-detail boundary: exactly one
// buffered view per request, optimistic base+1 only for counted renders,
// prefetch (router header or purpose hints) excluded, pending-review
// (sticky < 0) excluded.

import type { ForumContext, Thread } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forumApi } from "@/lib/forum-api";
import { getCurrentForumUser, getWorkerJwt } from "@/lib/forum-auth";
import { getCachedForumAncestors, getCachedThreadById, recordThreadView } from "@/lib/forum-cache";
import { loadThreadDetail } from "@/viewmodels/forum/thread-detail.server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/forum-cache", () => ({
	getCachedForumAncestors: vi.fn(),
	getCachedPostsPerPage: vi.fn(async () => 20),
	getCachedThreadById: vi.fn(),
	recordThreadView: vi.fn(),
}));
vi.mock("@/lib/forum-auth", () => ({
	getCurrentForumUser: vi.fn(async () => null),
	getWorkerJwt: vi.fn(async () => null),
	authPatch: vi.fn(),
}));
vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getAuth: vi.fn(),
		getCursor: vi.fn(),
		getCursorAuth: vi.fn(),
		post: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: (user: unknown) => user,
}));
vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: vi.fn(async () => ({})),
	getStr: () => "同济网论坛",
}));
vi.mock("@/lib/forum-breadcrumbs", () => ({
	buildThreadBreadcrumbsFromAncestors: vi.fn(() => []),
}));

const { headers } = await import("next/headers");

function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: 42,
		forumId: 7,
		subject: "Hello",
		authorId: 5,
		authorName: "alice",
		createdAt: 1_700_000_000,
		lastPostAt: 0,
		replies: 0,
		views: 100,
		digest: 0,
		sticky: 0,
		closed: 0,
		highlight: 0,
		typeId: 0,
		firstPostId: 0,
		...overrides,
	} as Thread;
}

const FORUM: ForumContext = {
	id: 7,
	parentId: 0,
	name: "Forum",
	status: 1,
	visibility: "public",
	type: "forum",
	moderators: "",
	moderatorIds: "",
	moderatorList: [],
};

let headerBag: Headers;

beforeEach(() => {
	vi.clearAllMocks();
	headerBag = new Headers();
	vi.mocked(headers).mockResolvedValue(headerBag);
	vi.mocked(getCurrentForumUser).mockResolvedValue(null);
	vi.mocked(getWorkerJwt).mockResolvedValue(null);
	vi.mocked(getCachedForumAncestors).mockResolvedValue({ forum: FORUM, ancestors: [] });
	vi.mocked(forumApi.getCursor).mockResolvedValue({ data: [], meta: { nextCursor: null } });
});

async function render(thread: Thread) {
	vi.mocked(getCachedThreadById).mockResolvedValue(thread);
	return loadThreadDetail({ threadId: thread.id });
}

describe("loadThreadDetail — doc/29 view counting", () => {
	it("counts once and shows the returned base + 1 on a full page render", async () => {
		const data = await render(makeThread());
		expect(recordThreadView).toHaveBeenCalledTimes(1);
		expect(recordThreadView).toHaveBeenCalledWith(42);
		expect(data.thread.views).toBe(101);
	});

	it("does not count identifiable router prefetches", async () => {
		headerBag.set("x-ellie-prefetch", "1");
		const data = await render(makeThread());
		expect(recordThreadView).not.toHaveBeenCalled();
		expect(data.thread.views).toBe(100);
	});

	it("does not count standard purpose/sec-purpose prefetch hints", async () => {
		headerBag.set("purpose", "prefetch");
		await render(makeThread());
		expect(recordThreadView).not.toHaveBeenCalled();

		vi.clearAllMocks();
		headerBag = new Headers({ "sec-purpose": "prefetch" });
		vi.mocked(headers).mockResolvedValue(headerBag);
		await render(makeThread());
		expect(recordThreadView).not.toHaveBeenCalled();
	});

	it.each([
		{ purpose: "prefetch, navigate" },
		{ "sec-purpose": "prefetch;prerender" },
		{ purpose: "navigate", "sec-purpose": "prefetch" },
	])("excludes combined prefetch hints %o", async (hints) => {
		headerBag = new Headers(hints);
		vi.mocked(headers).mockResolvedValue(headerBag);
		const data = await render(makeThread());
		expect(recordThreadView).not.toHaveBeenCalled();
		expect(data.thread.views).toBe(100);
	});

	it("does not count pending-review reads (sticky < 0)", async () => {
		const data = await render(makeThread({ sticky: -2 }));
		expect(recordThreadView).not.toHaveBeenCalled();
		expect(data.thread.views).toBe(100);
	});

	// Within-request dedupe is React cache() semantics inside the real
	// forum-cache wrapper (needs a request store, not observable here);
	// the single-call count above pins the loader-side contract.
});
