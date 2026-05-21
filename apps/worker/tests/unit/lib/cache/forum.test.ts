// Tests for forum v2 cache helpers (pure module — no IO).
//
// Covers bucket → context mapping, active+visibility filtering, payload
// builders (tree / summary / meta), and post-cache-read shape validators.

import type { Forum, ForumVisibility } from "@ellie/types";
import { ForumType, UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";
import {
	bucketToVisibilityContext,
	buildForumMetaPayload,
	buildForumSummaryPayload,
	buildForumTreePayload,
	filterForumsForBucket,
	isForumMetaPayload,
	isForumSummaryPayload,
	isForumTreePayload,
	isForumVisibleToBucket,
} from "../../../../src/lib/cache/forum";

// ─── Fixtures ─────────────────────────────────────────────────────

type ForumRow = Forum & { moderatorIds: string };

function makeForum(overrides: Partial<ForumRow> = {}): ForumRow {
	return {
		id: 1,
		parentId: 0,
		name: "test",
		description: "desc",
		announcement: "",
		icon: "",
		displayOrder: 0,
		threads: 10,
		posts: 100,
		type: ForumType.Forum,
		status: 1,
		visibility: "public",
		moderators: "",
		moderatorIds: "",
		moderatorList: [],
		todayThreads: 2,
		lastThreadId: 42,
		lastPostAt: 1700000000,
		lastPoster: "alice",
		lastPosterId: 7,
		lastPosterAvatar: "a.png",
		lastPosterAvatarPath: "/avatars/a.png",
		lastThreadSubject: "hello",
		...overrides,
	};
}

// ─── bucketToVisibilityContext ────────────────────────────────────

describe("cache/forum — bucketToVisibilityContext", () => {
	it("anon → not logged in, role=User", () => {
		expect(bucketToVisibilityContext("anon")).toEqual({ isLoggedIn: false, role: UserRole.User });
	});
	it("member → logged in, role=User", () => {
		expect(bucketToVisibilityContext("member")).toEqual({ isLoggedIn: true, role: UserRole.User });
	});
	it("staff → logged in, role=Mod", () => {
		expect(bucketToVisibilityContext("staff")).toEqual({ isLoggedIn: true, role: UserRole.Mod });
	});
	it("admin → logged in, role=Admin (NOT folded into staff)", () => {
		expect(bucketToVisibilityContext("admin")).toEqual({
			isLoggedIn: true,
			role: UserRole.Admin,
		});
	});
});

// ─── filterForumsForBucket ────────────────────────────────────────

describe("cache/forum — filterForumsForBucket", () => {
	const forums: Forum[] = [
		makeForum({ id: 1, status: 1, visibility: "public" }),
		makeForum({ id: 2, status: 0, visibility: "public" }), // inactive (hidden)
		makeForum({ id: 3, status: -1, visibility: "public" }), // deleted
		makeForum({ id: 4, status: 2, visibility: "public" }), // paused (not active)
		makeForum({ id: 5, status: 1, visibility: "members" }),
		makeForum({ id: 6, status: 1, visibility: "staff" }),
		makeForum({ id: 7, status: 1, visibility: "admin" }),
	];

	it("anon: only active+public", () => {
		expect(filterForumsForBucket(forums, "anon").map((f) => f.id)).toEqual([1]);
	});
	it("member: active public+members", () => {
		expect(filterForumsForBucket(forums, "member").map((f) => f.id)).toEqual([1, 5]);
	});
	it("staff: active public+members+staff (NOT admin)", () => {
		expect(filterForumsForBucket(forums, "staff").map((f) => f.id)).toEqual([1, 5, 6]);
	});
	it("admin: active across all visibilities (still drops inactive)", () => {
		expect(filterForumsForBucket(forums, "admin").map((f) => f.id)).toEqual([1, 5, 6, 7]);
	});
	it("inactive forums are dropped from EVERY bucket including admin", () => {
		// Sanity: status 0 / -1 / 2 never appear in any bucket result.
		for (const bucket of ["anon", "member", "staff", "admin"] as const) {
			const ids = filterForumsForBucket(forums, bucket).map((f) => f.id);
			expect(ids).not.toContain(2);
			expect(ids).not.toContain(3);
			expect(ids).not.toContain(4);
		}
	});
	it("preserves input order", () => {
		const reordered = [
			makeForum({ id: 5, visibility: "members" }),
			makeForum({ id: 1, visibility: "public" }),
		];
		expect(filterForumsForBucket(reordered, "member").map((f) => f.id)).toEqual([5, 1]);
	});
});

// ─── isForumVisibleToBucket ───────────────────────────────────────

describe("cache/forum — isForumVisibleToBucket", () => {
	it("null/undefined → false", () => {
		expect(isForumVisibleToBucket(null, "anon")).toBe(false);
		expect(isForumVisibleToBucket(undefined, "admin")).toBe(false);
	});
	it("inactive (status !== 1) → false even for admin", () => {
		expect(
			isForumVisibleToBucket({ status: 0, visibility: "public" as ForumVisibility }, "admin"),
		).toBe(false);
		expect(
			isForumVisibleToBucket({ status: -1, visibility: "admin" as ForumVisibility }, "admin"),
		).toBe(false);
	});
	it("active + visibility match → true", () => {
		expect(
			isForumVisibleToBucket({ status: 1, visibility: "admin" as ForumVisibility }, "admin"),
		).toBe(true);
		expect(
			isForumVisibleToBucket({ status: 1, visibility: "public" as ForumVisibility }, "anon"),
		).toBe(true);
	});
	it("active + visibility mismatch → false", () => {
		expect(
			isForumVisibleToBucket({ status: 1, visibility: "admin" as ForumVisibility }, "staff"),
		).toBe(false);
		expect(
			isForumVisibleToBucket({ status: 1, visibility: "members" as ForumVisibility }, "anon"),
		).toBe(false);
	});
});

// ─── buildForumTreePayload ────────────────────────────────────────

describe("cache/forum — buildForumTreePayload", () => {
	it("emits only structural fields (no aggregates)", () => {
		const f = makeForum({
			id: 10,
			parentId: 1,
			name: "kids",
			description: "d",
			icon: "i",
			displayOrder: 5,
			type: ForumType.Sub,
			status: 1,
			visibility: "public",
			moderators: "alice",
			moderatorIds: "1",
			moderatorList: [{ id: 1, name: "alice" }],
		});
		const payload = buildForumTreePayload([f], "anon");
		expect(payload.bucket).toBe("anon");
		expect(payload.forums).toHaveLength(1);
		const node = payload.forums[0];
		expect(node).toEqual({
			id: 10,
			parentId: 1,
			name: "kids",
			description: "d",
			icon: "i",
			displayOrder: 5,
			type: ForumType.Sub,
			status: 1,
			visibility: "public",
			moderators: "alice",
			moderatorIds: "1",
			moderatorList: [{ id: 1, name: "alice" }],
		});
		// No aggregate fields leaked through.
		expect(node).not.toHaveProperty("threads");
		expect(node).not.toHaveProperty("lastPostAt");
		expect(node).not.toHaveProperty("lastPosterAvatar");
	});

	it("preserves moderatorIds (required by /forums/:id/ancestors ForumContext)", () => {
		const f = makeForum({ id: 3, moderatorIds: "11,22,33" });
		const payload = buildForumTreePayload([f], "anon");
		expect(payload.forums[0].moderatorIds).toBe("11,22,33");
	});

	it("filters by bucket (admin-only forum hidden from member)", () => {
		const all: Forum[] = [
			makeForum({ id: 1, visibility: "public" }),
			makeForum({ id: 2, visibility: "admin" }),
		];
		expect(buildForumTreePayload(all, "member").forums.map((f) => f.id)).toEqual([1]);
		expect(buildForumTreePayload(all, "admin").forums.map((f) => f.id)).toEqual([1, 2]);
	});

	it("drops inactive forums for every bucket", () => {
		const all: Forum[] = [
			makeForum({ id: 1, status: 1, visibility: "admin" }),
			makeForum({ id: 2, status: 0, visibility: "admin" }),
		];
		expect(buildForumTreePayload(all, "admin").forums.map((f) => f.id)).toEqual([1]);
	});
});

// ─── buildForumSummaryPayload ─────────────────────────────────────

describe("cache/forum — buildForumSummaryPayload", () => {
	it("aggregates keyed by visible-only ids; includes lastPosterAvatar fields", () => {
		const all: Forum[] = [
			makeForum({
				id: 1,
				threads: 5,
				posts: 50,
				todayThreads: 1,
				lastThreadId: 100,
				lastThreadSubject: "subj-1",
				lastPostAt: 1234,
				lastPoster: "bob",
				lastPosterId: 9,
				lastPosterAvatar: "b.png",
				lastPosterAvatarPath: "/avatars/b.png",
			}),
			makeForum({ id: 2, visibility: "admin" }),
		];
		const payload = buildForumSummaryPayload(all, "member");
		expect(payload.bucket).toBe("member");
		expect(Object.keys(payload.aggregates)).toEqual(["1"]);
		expect(payload.aggregates[1]).toEqual({
			threads: 5,
			posts: 50,
			todayThreads: 1,
			lastThreadId: 100,
			lastThreadSubject: "subj-1",
			lastPostAt: 1234,
			lastPoster: "bob",
			lastPosterId: 9,
			lastPosterAvatar: "b.png",
			lastPosterAvatarPath: "/avatars/b.png",
		});
	});

	it("uses todayThreads from override (Forum & {todayThreads?})", () => {
		const f = makeForum({ id: 1 });
		// Override the todayThreads field on the merged input shape.
		const enriched = { ...f, todayThreads: 7 };
		const payload = buildForumSummaryPayload([enriched], "anon");
		expect(payload.aggregates[1].todayThreads).toBe(7);
	});

	it("defaults todayThreads to 0 when missing from input", () => {
		const f = makeForum({ id: 1 });
		// Force the property off the row to simulate a row that didn't compute it.
		const partial = { ...f } as Forum & { todayThreads?: number };
		partial.todayThreads = undefined as unknown as number;
		const payload = buildForumSummaryPayload([partial], "anon");
		expect(payload.aggregates[1].todayThreads).toBe(0);
	});

	it("admin-only forum appears for admin, not for staff", () => {
		const all: Forum[] = [makeForum({ id: 9, visibility: "admin" })];
		expect(Object.keys(buildForumSummaryPayload(all, "staff").aggregates)).toEqual([]);
		expect(Object.keys(buildForumSummaryPayload(all, "admin").aggregates)).toEqual(["9"]);
	});
});

// ─── buildForumMetaPayload ────────────────────────────────────────

describe("cache/forum — buildForumMetaPayload", () => {
	it("returns null for inactive forum (would be 404)", () => {
		const f = makeForum({ status: 0, visibility: "public" });
		expect(buildForumMetaPayload(f, "anon")).toBeNull();
		expect(buildForumMetaPayload(f, "admin")).toBeNull();
	});

	it("returns null when bucket cannot see (would be 403/404)", () => {
		const f = makeForum({ status: 1, visibility: "admin" });
		expect(buildForumMetaPayload(f, "anon")).toBeNull();
		expect(buildForumMetaPayload(f, "member")).toBeNull();
		expect(buildForumMetaPayload(f, "staff")).toBeNull();
	});

	it("returns {bucket, forum} for active + visible", () => {
		const f = makeForum({ id: 5, status: 1, visibility: "members" });
		const payload = buildForumMetaPayload(f, "member");
		expect(payload).toEqual({ bucket: "member", forum: f });
	});

	it("admin sees admin-only active forum", () => {
		const f = makeForum({ id: 6, status: 1, visibility: "admin" });
		const payload = buildForumMetaPayload(f, "admin");
		expect(payload?.bucket).toBe("admin");
		expect(payload?.forum.id).toBe(6);
	});
});

// ─── Validators ───────────────────────────────────────────────────

describe("cache/forum — validators", () => {
	const tt = { enabled: false, required: false, listable: false, prefix: false };
	const node = (overrides: Record<string, unknown> = {}) => ({
		id: 1,
		parentId: 0,
		name: "n",
		threadTypes: tt,
		...overrides,
	});

	it("isForumTreePayload: accepts well-formed payload", () => {
		expect(isForumTreePayload({ bucket: "anon", forums: [] })).toBe(true);
		expect(isForumTreePayload({ bucket: "anon", forums: [node()] })).toBe(true);
	});
	it("isForumTreePayload: rejects null/non-object/missing fields", () => {
		expect(isForumTreePayload(null)).toBe(false);
		expect(isForumTreePayload(undefined)).toBe(false);
		expect(isForumTreePayload("string")).toBe(false);
		expect(isForumTreePayload({})).toBe(false);
		expect(isForumTreePayload({ bucket: "anon" })).toBe(false);
		expect(isForumTreePayload({ forums: [] })).toBe(false);
		expect(isForumTreePayload({ bucket: 1, forums: [] })).toBe(false);
		expect(isForumTreePayload({ bucket: "anon", forums: "nope" })).toBe(false);
	});
	it("isForumTreePayload: rejects pre-threadTypes node payload (KV schema drift)", () => {
		// A `forum:tree:v2` payload written before commit ba100da6 lacks
		// `threadTypes` on each node — must be rejected so the read path
		// falls back to D1 and re-writes under the new shape.
		expect(
			isForumTreePayload({ bucket: "anon", forums: [{ id: 1, parentId: 0, name: "n" }] }),
		).toBe(false);
		// Partial threadTypes (e.g. missing `prefix`) is still drift.
		expect(
			isForumTreePayload({
				bucket: "anon",
				forums: [node({ threadTypes: { enabled: false, required: false, listable: false } })],
			}),
		).toBe(false);
		// Non-boolean members (truthy but wrong type) are drift.
		expect(
			isForumTreePayload({
				bucket: "anon",
				forums: [node({ threadTypes: { enabled: 0, required: 0, listable: 0, prefix: 0 } })],
			}),
		).toBe(false);
	});

	it("isForumSummaryPayload: accepts well-formed payload", () => {
		expect(isForumSummaryPayload({ bucket: "member", aggregates: {} })).toBe(true);
		expect(isForumSummaryPayload({ bucket: "admin", aggregates: { 1: {} } })).toBe(true);
	});
	it("isForumSummaryPayload: rejects bad shapes", () => {
		expect(isForumSummaryPayload(null)).toBe(false);
		expect(isForumSummaryPayload({ bucket: "x" })).toBe(false);
		expect(isForumSummaryPayload({ aggregates: {} })).toBe(false);
		expect(isForumSummaryPayload({ bucket: "x", aggregates: null })).toBe(false);
		expect(isForumSummaryPayload({ bucket: 0, aggregates: {} })).toBe(false);
	});

	it("isForumMetaPayload: accepts well-formed payload", () => {
		expect(
			isForumMetaPayload({ bucket: "anon", forum: { id: 1, threadTypes: tt, announcement: "" } }),
		).toBe(true);
	});
	it("isForumMetaPayload: rejects bad shapes", () => {
		expect(isForumMetaPayload(null)).toBe(false);
		expect(isForumMetaPayload({ bucket: "anon" })).toBe(false);
		expect(isForumMetaPayload({ forum: {} })).toBe(false);
		expect(isForumMetaPayload({ bucket: "anon", forum: null })).toBe(false);
		expect(isForumMetaPayload({ bucket: 0, forum: {} })).toBe(false);
	});
	it("isForumMetaPayload: rejects pre-threadTypes forum payload (KV schema drift)", () => {
		// `forum:meta:v2` payload written before commit ba100da6 lacks
		// `forum.threadTypes` — getThreadTypes() would NPE on
		// `cfg.enabled`. Must be rejected.
		expect(isForumMetaPayload({ bucket: "anon", forum: { id: 1 } })).toBe(false);
		expect(
			isForumMetaPayload({
				bucket: "anon",
				forum: { id: 1, threadTypes: { enabled: true, required: true, listable: true } },
			}),
		).toBe(false);
	});
	it("isForumMetaPayload: rejects pre-announcement forum payload (mig 0044 drift)", () => {
		// Payloads written before migration 0044 lack `forum.announcement`.
		// Must be rejected so the meta read path falls back to D1 and
		// rewrites with the populated column.
		expect(isForumMetaPayload({ bucket: "anon", forum: { id: 1, threadTypes: tt } })).toBe(false);
		expect(
			isForumMetaPayload({
				bucket: "anon",
				forum: { id: 1, threadTypes: tt, announcement: null },
			}),
		).toBe(false);
		expect(
			isForumMetaPayload({
				bucket: "anon",
				forum: { id: 1, threadTypes: tt, announcement: 123 },
			}),
		).toBe(false);
	});
});
