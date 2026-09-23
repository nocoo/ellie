import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deletePost } from "@/app/api/v1/me/posts/[id]/route";
import { DELETE as deleteThread } from "@/app/api/v1/me/threads/[id]/route";
import { PATCH as sticky } from "@/app/api/v1/moderation/threads/[id]/sticky/route";
import { POST as nuke } from "@/app/api/v1/moderation/users/[id]/nuke/route";
import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { getMemoryRuntime } from "@/lib/memory-runtime";

vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: vi.fn(async () => "verified-jwt") }));
vi.mock("@/lib/memory-runtime", () => ({ getMemoryRuntime: vi.fn(() => ({ clear: vi.fn() })) }));
vi.mock("@/lib/forum-api", async (original) => ({
	...(await original<typeof import("@/lib/forum-api")>()),
	forumApi: { deleteAuth: vi.fn(), patchAuth: vi.fn(), postAuth: vi.fn() },
}));

const clear = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getMemoryRuntime).mockReturnValue({ clear } as ReturnType<typeof getMemoryRuntime>);
	process.env.AUTH_URL = "https://web.example.com";
});

describe("successful writes invalidate local display caches", () => {
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
			expect(clear.mock.calls.map(([family]) => family)).toEqual([
				"forum-summary",
				"thread-count",
				"site-stats",
			]);
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
		expect(clear.mock.calls).toEqual(
			["anon", "member", "staff", "admin"].map((bucket) => [
				"forum-summary",
				`bucket:${bucket}:forum:7`,
			]),
		);
	});
});
