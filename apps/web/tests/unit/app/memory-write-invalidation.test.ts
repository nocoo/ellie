import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deletePost } from "@/app/api/v1/me/posts/[id]/route";
import { DELETE as deleteThread } from "@/app/api/v1/me/threads/[id]/route";
import { PATCH as digest } from "@/app/api/v1/moderation/threads/[id]/digest/route";
import { PATCH as sticky } from "@/app/api/v1/moderation/threads/[id]/sticky/route";
import { POST as nuke } from "@/app/api/v1/moderation/users/[id]/nuke/route";
import { POST as createReply } from "@/app/api/v1/posts/route";
import { POST as createThread } from "@/app/api/v1/threads/route";
import { PATCH as patchMe } from "@/app/api/v1/users/me/route";
import {
	invalidateDisplayAfterWrite,
	mutationForumId,
	mutationThreadId,
	parseRouteId,
} from "@/lib/display-invalidation";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { authPatch } from "@/lib/forum-auth";
import { getMemoryRuntime } from "@/lib/memory-runtime";

const optimistic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/daily-statistics", () => ({ getDailyStatistics: () => ({ optimistic }) }));
vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: vi.fn(async () => "verified-jwt"),
	authPatch: vi.fn(),
}));
vi.mock("@/lib/memory-runtime", () => ({ getMemoryRuntime: vi.fn(() => ({ clear: vi.fn() })) }));
vi.mock("@/lib/forum-api", async (original) => ({
	...(await original<typeof import("@/lib/forum-api")>()),
	forumApi: { deleteAuth: vi.fn(), patchAuth: vi.fn(), postAuth: vi.fn() },
}));

const clear = vi.fn();
const clearPrefix = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getMemoryRuntime).mockReturnValue({ clear, clearPrefix } as ReturnType<
		typeof getMemoryRuntime
	>);
	process.env.AUTH_URL = "https://web.example.com";
});

describe("successful writes invalidate local display caches", () => {
	it.each([0, 1, 2, undefined, "0"])(
		"scopes replies using authoritative sticky metadata %s",
		async (threadSticky) => {
			vi.mocked(forumApi.postAuth).mockResolvedValue({
				data: { forumId: 7, threadId: 5 },
				meta: { threadSticky },
			} as never);
			const response = await createReply(
				new Request("https://web.example.com/api/v1/posts", {
					method: "POST",
					headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
					body: JSON.stringify({ threadId: 5, content: "Reply", forumId: 99, threadSticky: 0 }),
				}),
			);
			expect(response.status).toBe(201);
			expect(optimistic).toHaveBeenCalledExactlyOnceWith({ kind: "post", forumId: 7 });
			if (threadSticky === 0 || threadSticky === 1) {
				expect(clearPrefix).toHaveBeenCalledExactlyOnceWith("forum-list", "forum:7:");
				expect(clear).not.toHaveBeenCalledWith("forum-list");
			} else {
				expect(clear).toHaveBeenCalledWith("forum-list");
				expect(clearPrefix).not.toHaveBeenCalled();
			}
			// Reply always forwards a proven threadId from the Worker Post.
			expect(clear).toHaveBeenCalledWith("thread-detail", "thread:5");
		},
	);
	it.each([undefined, 11])(
		"increments successful thread creation without trusting the submitted forum id (%s)",
		async (typeId) => {
			vi.mocked(forumApi.postAuth).mockResolvedValue({
				data: { id: 5, forumId: 7, typeId: typeId ?? 0 },
			});
			const response = await createThread(
				new Request("https://web.example.com/api/v1/threads", {
					method: "POST",
					headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
					body: JSON.stringify({ forumId: 99, typeId, subject: "Topic", content: "Body" }),
				}),
			);
			expect(response.status).toBe(201);
			expect(optimistic).toHaveBeenCalledExactlyOnceWith({
				kind: "thread",
				forumId: 7,
				typeId: typeId ?? 0,
			});
		},
	);

	it.each([createThread, createReply])(
		"does not increment daily statistics when creation fails",
		async (route) => {
			vi.mocked(forumApi.postAuth).mockRejectedValue(
				new ForumApiError(403, { code: "FORBIDDEN", message: "Denied" }),
			);
			const response = await route(
				new Request("https://web.example.com/api/v1/resource", {
					method: "POST",
					headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
					body: JSON.stringify({ forumId: 7, threadId: 5, subject: "Topic", content: "Body" }),
				}),
			);
			expect(response.status).toBe(403);
			expect(optimistic).not.toHaveBeenCalled();
			expect(clear).not.toHaveBeenCalled();
		},
	);

	it.each([
		["DELETE", deleteThread, forumApi.deleteAuth],
		["DELETE", deletePost, forumApi.deleteAuth],
		["PATCH", sticky, forumApi.patchAuth],
		["POST", nuke, forumApi.postAuth],
	] as const)(
		"invalidates after %s succeeds and preserves cache after failure",
		async (method, route, call) => {
			const request = () =>
				new NextRequest("https://web.example.com/api/v1/resource/1", {
					method,
					headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
					body: JSON.stringify({ sticky: 0 }),
				});
			vi.mocked(call).mockResolvedValue({ data: { ok: true } });
			expect((await route(request(), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
			const families = clear.mock.calls.map(([family, key]) => [family, key]);
			if (method === "DELETE" && route === deletePost) {
				// Deleting a post does NOT change the local thread-count.
				expect(families).toEqual([
					["forum-summary", undefined],
					["home-display", undefined],
					["forum-list", undefined],
					["thread-detail", undefined],
				]);
			} else if (route === deleteThread || route === sticky) {
				// Both forward the route's `id` as a proven threadId.
				expect(families).toEqual([
					["forum-summary", undefined],
					["home-display", undefined],
					["forum-list", undefined],
					["thread-detail", "thread:1"],
				]);
			} else {
				// nuke (POST): no threadId (userId), default full clear.
				expect(families).toEqual([
					["forum-summary", undefined],
					["home-display", undefined],
					["forum-list", undefined],
					["thread-detail", undefined],
				]);
			}
			clear.mockClear();
			vi.mocked(call).mockRejectedValue(
				new ForumApiError(403, { code: "FORBIDDEN", message: "Denied" }),
			);
			expect((await route(request(), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
			expect(clear).not.toHaveBeenCalled();
		},
	);

	it("clears only the selected forum summary in each authorized bucket", () => {
		invalidateDisplayAfterWrite({ forumId: 7, forumSummaries: true });
		expect(clear.mock.calls).toEqual([
			...["anon", "member", "staff", "admin"].map((bucket) => [
				"forum-summary",
				`bucket:${bucket}:forum:7`,
			]),
			["home-display"],
			// domain flag default → thread-detail full clear
			["thread-detail"],
		]);
	});

	it("implies home-display from any existing domain flag", () => {
		invalidateDisplayAfterWrite({ homeDisplay: true });
		expect(clear.mock.calls).toEqual([["home-display"], ["forum-list"], ["thread-detail"]]);
	});

	it("clears both display families for display-only triggers", () => {
		invalidateDisplayAfterWrite({ homeDisplay: true });
		expect(clear.mock.calls).toEqual([["home-display"], ["forum-list"], ["thread-detail"]]);
	});

	it("does nothing without flags", () => {
		invalidateDisplayAfterWrite({});
		expect(clear).not.toHaveBeenCalled();
	});

	it("digest level changes clear both display families after success", async () => {
		const request = () =>
			new NextRequest("https://web.example.com/api/v1/moderation/threads/1/digest", {
				method: "PATCH",
				headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
				body: JSON.stringify({ level: 1 }),
			});
		vi.mocked(forumApi.patchAuth).mockResolvedValue({ data: { id: 1, level: 1 } });
		expect((await digest(request(), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
		expect(clear.mock.calls).toEqual([
			["home-display"],
			["forum-list"],
			["thread-detail", "thread:1"],
		]);
		clear.mockClear();
		vi.mocked(forumApi.patchAuth).mockRejectedValue(
			new ForumApiError(403, { code: "FORBIDDEN", message: "Denied" }),
		);
		expect((await digest(request(), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
		expect(clear).not.toHaveBeenCalled();
	});

	it("profile display changes clear forum summaries and home display after success", async () => {
		const request = () =>
			new NextRequest("https://web.example.com/api/v1/users/me", {
				method: "PATCH",
				headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
				body: JSON.stringify({ display_name: "new" }),
			});
		vi.mocked(authPatch).mockResolvedValue({
			data: { id: 1 },
			meta: { timestamp: 1, requestId: "r" },
		} as Awaited<ReturnType<typeof authPatch>>);
		expect((await patchMe(request())).status).toBe(200);
		expect(clear.mock.calls).toEqual([
			["forum-summary"],
			["home-display"],
			["forum-list"],
			["thread-detail"],
		]);
		clear.mockClear();
		vi.mocked(authPatch).mockResolvedValue({ error: "NOT_AUTHENTICATED" } as Awaited<
			ReturnType<typeof authPatch>
		>);
		expect((await patchMe(request())).status).toBe(401);
		expect(clear).not.toHaveBeenCalled();
	});
});

it("scopes all cached pages of affected forums and clears unknown scope", () => {
	invalidateDisplayAfterWrite({ forumLists: true, forumIds: [7, 8, 7] });
	expect(clearPrefix.mock.calls).toEqual([
		["forum-list", "forum:7:"],
		["forum-list", "forum:8:"],
	]);
	invalidateDisplayAfterWrite({ forumLists: true, forumIds: [0] });
	expect(clear).toHaveBeenCalledWith("forum-list");
});
it("extracts only an authoritative positive forum id from write envelopes", () => {
	for (const value of [
		null,
		{},
		{ data: null },
		{ data: {} },
		{ data: { forumId: 0 } },
		{ data: { forumId: "7" } },
	])
		expect(mutationForumId(value)).toBeUndefined();
	expect(mutationForumId({ data: { forumId: 7 } })).toBe(7);
});

describe("mutationThreadId + parseRouteId helpers", () => {
	it.each([
		null,
		{},
		{ data: null },
		{ data: {} },
		{ data: { threadId: 0 } },
		{ data: { threadId: "5" } },
		{ data: { threadId: 1.5 } },
		{ data: { threadId: Number.MAX_SAFE_INTEGER + 2 } },
	])("rejects non-integer or non-positive data.threadId from %j", (value) => {
		expect(mutationThreadId(value)).toBeUndefined();
	});

	it("ignores data.id — the post id is never a thread selector", () => {
		expect(mutationThreadId({ data: { id: 9 } })).toBeUndefined();
		expect(mutationThreadId({ data: { threadId: 5, id: 9 } })).toBe(5);
	});

	it("reads data.threadId when present", () => {
		expect(mutationThreadId({ data: { threadId: 5 } })).toBe(5);
	});

	it.each([
		["", undefined],
		["0", undefined],
		["-1", undefined],
		["1.5", undefined],
		["abc", undefined],
		["123", 123],
	])("parseRouteId(%j) -> %j", (input, expected) => {
		expect(parseRouteId(input)).toBe(expected);
	});

	it("rejects ambiguous numeric strings so legacy Worker parsing cannot clear the wrong topic", () => {
		expect(parseRouteId("1e2")).toBeUndefined();
		expect(parseRouteId("1.0")).toBeUndefined();
	});

	it("parseRouteId accepts numeric input", () => {
		expect(parseRouteId(42)).toBe(42);
		expect(parseRouteId(0)).toBeUndefined();
		expect(parseRouteId(-1)).toBeUndefined();
	});
});

describe("reply route thread-detail invalidation", () => {
	beforeEach(() => {
		process.env.AUTH_URL = "https://web.example.com";
	});

	it("clears a single thread-detail key when the Worker Post carries data.threadId", async () => {
		vi.mocked(forumApi.postAuth).mockResolvedValue({
			data: { id: 99, threadId: 5, forumId: 7 },
			meta: { threadSticky: 0 },
		} as never);
		const response = await createReply(
			new Request("https://web.example.com/api/v1/posts", {
				method: "POST",
				headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
				body: JSON.stringify({ threadId: 5, content: "Reply", forumId: 7 }),
			}),
		);
		expect(response.status).toBe(201);
		// Post id (99) is NOT used as a thread selector.
		expect(clear).toHaveBeenCalledWith("thread-detail", "thread:5");
		expect(clear).not.toHaveBeenCalledWith("thread-detail", "thread:99");
	});

	it("falls back to the domain-flag default full clear when threadId is missing", async () => {
		vi.mocked(forumApi.postAuth).mockResolvedValue({
			data: { id: 99, forumId: 7 },
			meta: { threadSticky: 0 },
		} as never);
		const response = await createReply(
			new Request("https://web.example.com/api/v1/posts", {
				method: "POST",
				headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
				body: JSON.stringify({ threadId: 5, content: "Reply", forumId: 7 }),
			}),
		);
		expect(response.status).toBe(201);
		// No precise selector => full clear via the forumSummaries default.
		expect(clear).toHaveBeenCalledWith("thread-detail");
		expect(clear).not.toHaveBeenCalledWith("thread-detail", "thread:99");
	});
});

describe("thread-detail invalidation", () => {
	it("clears a single thread-detail key when threadId is a safe positive integer", () => {
		invalidateDisplayAfterWrite({ threadDetail: { threadId: 7 } });
		expect(clear).toHaveBeenCalledWith("thread-detail", "thread:7");
		expect(clear).not.toHaveBeenCalledWith("thread-detail");
	});

	it("clears the bounded family when the requested thread selector is invalid", () => {
		invalidateDisplayAfterWrite({ threadDetail: { threadId: 0 } });
		invalidateDisplayAfterWrite({ threadDetail: { threadId: -1 } });
		invalidateDisplayAfterWrite({ threadDetail: { threadId: 1.5 } });
		expect(clear).toHaveBeenCalledTimes(3);
		expect(clear).toHaveBeenCalledWith("thread-detail");
	});

	it("clears the whole thread-detail family when all is true", () => {
		invalidateDisplayAfterWrite({ threadDetail: { all: true } });
		expect(clear).toHaveBeenCalledWith("thread-detail");
	});

	it("overrides domain-flag default with proven threadId", () => {
		invalidateDisplayAfterWrite({
			forumSummaries: true,
			threadDetail: { threadId: 7 },
		});
		expect(clear).toHaveBeenCalledWith("thread-detail", "thread:7");
		expect(clear).not.toHaveBeenCalledWith("thread-detail");
	});

	it("falls back to bounded full clear when no domain flag and no threadDetail", () => {
		invalidateDisplayAfterWrite({});
		expect(clear).not.toHaveBeenCalledWith("thread-detail");
	});
});
