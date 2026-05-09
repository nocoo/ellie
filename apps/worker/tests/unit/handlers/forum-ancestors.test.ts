import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAncestors } from "../../../src/handlers/forum";
import { createMockCtx, makeEnv } from "../../helpers";

// Mock the auth middleware and v2 forum tree reader
vi.mock("../../../src/middleware/auth", () => ({
	optionalAuthVerified: vi.fn(async () => null),
}));

vi.mock("../../../src/lib/cache/forum-read", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/forum-read")>(
		"../../../src/lib/cache/forum-read",
	);
	return {
		...actual,
		getForumTreeV2: vi.fn(),
		lazyForumSnapshot: vi.fn(() => async () => ({ all: [], visibleByBucket: {} })),
	};
});

import type { ForumTreeNodeV2 } from "../../../src/lib/cache/forum";
import { getForumTreeV2 } from "../../../src/lib/cache/forum-read";
import { optionalAuthVerified } from "../../../src/middleware/auth";

const mockGetTree = getForumTreeV2 as ReturnType<typeof vi.fn>;
const mockOptionalAuth = optionalAuthVerified as ReturnType<typeof vi.fn>;

function makeNode(overrides?: Partial<ForumTreeNodeV2>): ForumTreeNodeV2 {
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
		moderators: "",
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

	it("returns 404 when forum is not in the visible tree", async () => {
		mockGetTree.mockResolvedValue([makeNode({ id: 1, status: 1, visibility: "public" })]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/999/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(404);
	});

	it("returns forum context and empty ancestors for root forum", async () => {
		mockGetTree.mockResolvedValue([makeNode({ id: 1, parentId: 0, name: "Root Forum" })]);
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
		mockGetTree.mockResolvedValue([
			makeNode({ id: 1, parentId: 0, name: "Root" }),
			makeNode({ id: 2, parentId: 1, name: "Category", type: "forum" }),
			makeNode({ id: 3, parentId: 2, name: "Sub Forum", type: "sub" }),
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

	it("terminates chain when parent is missing from the pre-filtered tree", async () => {
		// v2 pre-filters hidden / non-permitted nodes out of the tree.
		// Walking through a missing parent is impossible — chain ends there.
		mockGetTree.mockResolvedValue([
			// id=1 (Root) is omitted as if it were hidden — only the child present
			makeNode({ id: 3, parentId: 2, name: "Visible Child" }),
		]);
		const env = makeEnv();
		const ctx = createMockCtx();
		const req = new Request("https://api.example.com/api/v1/forums/3/ancestors");

		const res = await getAncestors(req, env, ctx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.ancestors).toEqual([]);
	});

	it("walks past visible ancestors to root", async () => {
		mockGetTree.mockResolvedValue([
			makeNode({ id: 1, parentId: 0, name: "Root" }),
			makeNode({ id: 2, parentId: 1, name: "Visible Parent" }),
			makeNode({ id: 3, parentId: 2, name: "Target" }),
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
		mockOptionalAuth.mockResolvedValue({ userId: 1, role: 3 });
		mockGetTree.mockResolvedValue([
			makeNode({ id: 1, parentId: 0, name: "Root" }),
			makeNode({ id: 10, parentId: 1, name: "Staff Only", visibility: "staff" }),
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

	it("returns forum context with moderators and moderatorList", async () => {
		mockGetTree.mockResolvedValue([
			makeNode({
				id: 1,
				parentId: 0,
				moderators: "mod_alice,mod_bob",
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
		expect(body.data.forum.moderators).toBe("mod_alice,mod_bob");
		expect(body.data.forum.moderatorList).toEqual([
			{ id: 10, name: "mod_alice" },
			{ id: 20, name: "mod_bob" },
		]);
	});
});
