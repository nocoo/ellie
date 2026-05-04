import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAncestors } from "../../../src/handlers/forum";
import { createMockCtx, makeEnv } from "../../helpers";

// Mock the auth middleware and forum-cache
vi.mock("../../../src/middleware/auth", () => ({
	optionalAuthVerified: vi.fn(async () => null),
}));

vi.mock("../../../src/lib/forum-cache", () => ({
	getForumTree: vi.fn(),
	isForumCacheEnabled: vi.fn(() => true),
}));

import { getForumTree } from "../../../src/lib/forum-cache";
import type { ForumTreeEntry } from "../../../src/lib/forum-cache";
import { optionalAuthVerified } from "../../../src/middleware/auth";

const mockGetForumTree = getForumTree as ReturnType<typeof vi.fn>;
const mockOptionalAuth = optionalAuthVerified as ReturnType<typeof vi.fn>;

function makeTreeEntry(overrides?: Partial<ForumTreeEntry>): ForumTreeEntry {
	return {
		id: 1,
		parentId: 0,
		name: "Root",
		description: "",
		icon: "",
		displayOrder: 1,
		status: 1,
		visibility: "public",
		type: "group",
		moderatorIds: "",
		moderatorList: [],
		...overrides,
	};
}

describe("getAncestors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockOptionalAuth.mockResolvedValue(null); // anonymous user
	});

	it("returns 400 for invalid forum ID", async () => {
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/abc/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(400);
	});

	it("returns 404 when forum is not in the visible set", async () => {
		mockGetForumTree.mockResolvedValue([makeTreeEntry({ id: 1, status: 1, visibility: "public" })]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/999/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns 404 when forum is hidden (status != 1)", async () => {
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 5, status: 0, visibility: "public" }), // hidden
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/5/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns 404 for staff-only forum when user is anonymous", async () => {
		mockGetForumTree.mockResolvedValue([makeTreeEntry({ id: 5, status: 1, visibility: "staff" })]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/5/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns forum context and empty ancestors for root forum", async () => {
		mockGetForumTree.mockResolvedValue([makeTreeEntry({ id: 1, parentId: 0, name: "Root Forum" })]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/1/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.forum.id).toBe(1);
		expect(body.data.forum.name).toBe("Root Forum");
		expect(body.data.ancestors).toEqual([]);
	});

	it("returns correct ancestor chain for nested forum", async () => {
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 2, parentId: 1, name: "Category", type: "forum" }),
			makeTreeEntry({ id: 3, parentId: 2, name: "Sub Forum", type: "sub" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/3/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.forum.id).toBe(3);
		expect(body.data.forum.name).toBe("Sub Forum");
		expect(body.data.ancestors).toEqual([
			{ id: 1, parentId: 0, name: "Root" },
			{ id: 2, parentId: 1, name: "Category" },
		]);
	});

	it("omits hidden ancestor from chain (don't leak names)", async () => {
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 2, parentId: 1, name: "Hidden Parent", status: 0 }), // hidden
			makeTreeEntry({ id: 3, parentId: 2, name: "Visible Child" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/3/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		// Chain terminates at the hidden ancestor — can't walk through id=2
		// so Root is unreachable even though it's visible
		expect(body.data.ancestors).toEqual([]);
	});

	it("walks past visible ancestors to root", async () => {
		// All ancestors are visible — full chain is returned
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 2, parentId: 1, name: "Visible Parent" }),
			makeTreeEntry({ id: 3, parentId: 2, name: "Target" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/3/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.ancestors).toEqual([
			{ id: 1, parentId: 0, name: "Root" },
			{ id: 2, parentId: 1, name: "Visible Parent" },
		]);
	});

	it("returns staff forum context when user has mod role", async () => {
		// User is a moderator (role=3)
		mockOptionalAuth.mockResolvedValue({ userId: 1, role: 3 });
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 10, parentId: 1, name: "Staff Only", visibility: "staff" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/10/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.forum.id).toBe(10);
		expect(body.data.forum.name).toBe("Staff Only");
		expect(body.data.ancestors).toEqual([{ id: 1, parentId: 0, name: "Root" }]);
	});

	it("handles members-only forum for logged-in user", async () => {
		mockOptionalAuth.mockResolvedValue({ userId: 42, role: 0 }); // regular logged-in user
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 5, parentId: 1, name: "Members Only", visibility: "members" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/5/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.forum.name).toBe("Members Only");
	});

	it("returns 404 for members-only forum when anonymous", async () => {
		mockOptionalAuth.mockResolvedValue(null);
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({ id: 1, parentId: 0, name: "Root" }),
			makeTreeEntry({ id: 5, parentId: 1, name: "Members Only", visibility: "members" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/5/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns forum context with moderatorList", async () => {
		mockGetForumTree.mockResolvedValue([
			makeTreeEntry({
				id: 1,
				parentId: 0,
				moderatorIds: "10,20",
				moderatorList: [
					{ id: 10, name: "mod_alice" },
					{ id: 20, name: "mod_bob" },
				],
			}),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/1/ancestors");

		const res = await getAncestors(req, env, ctx);
		const body = await res.json();
		expect(body.data.forum.moderatorList).toEqual([
			{ id: 10, name: "mod_alice" },
			{ id: 20, name: "mod_bob" },
		]);
	});

	it("invokes getForumTree with env and ctx", async () => {
		mockGetForumTree.mockResolvedValue([makeTreeEntry({ id: 1, parentId: 0 })]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/1/ancestors");

		await getAncestors(req, env, ctx);

		expect(mockGetForumTree).toHaveBeenCalledWith(env, ctx);
	});
});
