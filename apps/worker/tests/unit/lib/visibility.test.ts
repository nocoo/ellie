import { describe, expect, it } from "bun:test";
import { UserRole } from "@ellie/types";
import {
	FORUM_ACTIVE,
	ForumStatusLevel,
	POST_VISIBLE,
	PostInvisibleLevel,
	THREAD_VISIBLE,
	ThreadStickyLevel,
	USER_ACTIVE,
	UserStatusLevel,
	buildForumFilter,
	buildForumVisibilityFilter,
	buildVisibilityContext,
	canViewForumVisibility,
	forumActive,
	isUserArchived,
	isUserBanned,
	isUserPlaceholder,
	isUserPublic,
	postListFilters,
	postVisible,
	threadListFilters,
	threadVisible,
	userActive,
} from "../../../src/lib/visibility";

// ─── SQL Constants ─────────────────────────────────────────

describe("SQL constants", () => {
	it("exports correct constant values", () => {
		expect(THREAD_VISIBLE).toBe("sticky >= 0");
		expect(POST_VISIBLE).toBe("invisible = 0");
		expect(USER_ACTIVE).toBe("status >= 0");
		expect(FORUM_ACTIVE).toBe("status = 1");
	});
});

// ─── Table-prefixed functions ──────────────────────────────

describe("table-prefixed SQL helpers", () => {
	it("uses default alias", () => {
		expect(threadVisible()).toBe("t.sticky >= 0");
		expect(postVisible()).toBe("p.invisible = 0");
		expect(userActive()).toBe("u.status >= 0");
		expect(forumActive()).toBe("f.status = 1");
	});

	it("uses custom alias", () => {
		expect(threadVisible("th")).toBe("th.sticky >= 0");
		expect(postVisible("posts")).toBe("posts.invisible = 0");
		expect(userActive("usr")).toBe("usr.status >= 0");
		expect(forumActive("forums")).toBe("forums.status = 1");
	});
});

// ─── User Status Checks ───────────────────────────────────

describe("isUserPublic", () => {
	it("returns true for status >= 0", () => {
		expect(isUserPublic(0)).toBe(true);
		expect(isUserPublic(1)).toBe(true);
	});
	it("returns false for negative status", () => {
		expect(isUserPublic(-1)).toBe(false);
		expect(isUserPublic(-2)).toBe(false);
		expect(isUserPublic(-3)).toBe(false);
	});
});

describe("isUserBanned", () => {
	it("returns true only for -1", () => {
		expect(isUserBanned(-1)).toBe(true);
		expect(isUserBanned(0)).toBe(false);
		expect(isUserBanned(-2)).toBe(false);
	});
});

describe("isUserArchived", () => {
	it("returns true only for -2", () => {
		expect(isUserArchived(-2)).toBe(true);
		expect(isUserArchived(-1)).toBe(false);
		expect(isUserArchived(0)).toBe(false);
	});
});

describe("isUserPlaceholder", () => {
	it("returns true only for -3", () => {
		expect(isUserPlaceholder(-3)).toBe(true);
		expect(isUserPlaceholder(-1)).toBe(false);
		expect(isUserPlaceholder(0)).toBe(false);
	});
});

// ─── buildVisibilityContext ────────────────────────────────

describe("buildVisibilityContext", () => {
	it("returns guest context when user is null", () => {
		const ctx = buildVisibilityContext(null);
		expect(ctx.isLoggedIn).toBe(false);
		expect(ctx.role).toBe(UserRole.User);
	});

	it("returns logged-in context with role", () => {
		const ctx = buildVisibilityContext({ userId: 1, role: UserRole.Admin });
		expect(ctx.isLoggedIn).toBe(true);
		expect(ctx.role).toBe(UserRole.Admin);
	});
});

// ─── buildForumVisibilityFilter ────────────────────────────

describe("buildForumVisibilityFilter", () => {
	it("guest sees only public", () => {
		const ctx = { isLoggedIn: false, role: UserRole.User };
		expect(buildForumVisibilityFilter(ctx)).toBe("(f.visibility = 'public')");
	});

	it("logged-in user sees public + members", () => {
		const ctx = { isLoggedIn: true, role: UserRole.User };
		expect(buildForumVisibilityFilter(ctx)).toBe(
			"(f.visibility = 'public' OR f.visibility = 'members')",
		);
	});

	it("Mod sees public + members + staff", () => {
		const ctx = { isLoggedIn: true, role: UserRole.Mod };
		expect(buildForumVisibilityFilter(ctx)).toBe(
			"(f.visibility = 'public' OR f.visibility = 'members' OR f.visibility = 'staff')",
		);
	});

	it("SuperMod sees public + members + staff", () => {
		const ctx = { isLoggedIn: true, role: UserRole.SuperMod };
		expect(buildForumVisibilityFilter(ctx)).toBe(
			"(f.visibility = 'public' OR f.visibility = 'members' OR f.visibility = 'staff')",
		);
	});

	it("Admin sees all levels", () => {
		const ctx = { isLoggedIn: true, role: UserRole.Admin };
		expect(buildForumVisibilityFilter(ctx)).toBe(
			"(f.visibility = 'public' OR f.visibility = 'members' OR f.visibility = 'staff' OR f.visibility = 'admin')",
		);
	});

	it("uses custom alias", () => {
		const ctx = { isLoggedIn: false, role: UserRole.User };
		expect(buildForumVisibilityFilter(ctx, "forums")).toBe("(forums.visibility = 'public')");
	});
});

// ─── buildForumFilter ──────────────────────────────────────

describe("buildForumFilter", () => {
	it("combines status and visibility filter", () => {
		const ctx = { isLoggedIn: false, role: UserRole.User };
		expect(buildForumFilter(ctx)).toBe("f.status = 1 AND (f.visibility = 'public')");
	});

	it("uses custom alias", () => {
		const ctx = { isLoggedIn: true, role: UserRole.User };
		expect(buildForumFilter(ctx, "x")).toBe(
			"x.status = 1 AND (x.visibility = 'public' OR x.visibility = 'members')",
		);
	});
});

// ─── canViewForumVisibility ────────────────────────────────

describe("canViewForumVisibility", () => {
	const guest = { isLoggedIn: false, role: UserRole.User };
	const member = { isLoggedIn: true, role: UserRole.User };
	const mod = { isLoggedIn: true, role: UserRole.Mod };
	const admin = { isLoggedIn: true, role: UserRole.Admin };

	it("public is visible to everyone", () => {
		expect(canViewForumVisibility("public", guest)).toBe(true);
		expect(canViewForumVisibility("public", member)).toBe(true);
	});

	it("members requires login", () => {
		expect(canViewForumVisibility("members", guest)).toBe(false);
		expect(canViewForumVisibility("members", member)).toBe(true);
	});

	it("staff requires Mod/SuperMod/Admin", () => {
		expect(canViewForumVisibility("staff", member)).toBe(false);
		expect(canViewForumVisibility("staff", mod)).toBe(true);
		expect(canViewForumVisibility("staff", admin)).toBe(true);
	});

	it("admin requires Admin role", () => {
		expect(canViewForumVisibility("admin", mod)).toBe(false);
		expect(canViewForumVisibility("admin", admin)).toBe(true);
	});

	it("unknown visibility returns false", () => {
		expect(canViewForumVisibility("unknown" as never, admin)).toBe(false);
	});
});

// ─── threadListFilters ─────────────────────────────────────

describe("threadListFilters", () => {
	it("returns correct conditions for guest", () => {
		const ctx = { isLoggedIn: false, role: UserRole.User };
		const filters = threadListFilters(ctx);
		expect(filters.threadCondition).toBe("t.sticky >= 0");
		expect(filters.forumCondition).toBe("f.status = 1");
		expect(filters.forumVisibility).toBe("(f.visibility = 'public')");
	});
});

// ─── postListFilters ───────────────────────────────────────

describe("postListFilters", () => {
	it("returns correct conditions for logged-in user", () => {
		const ctx = { isLoggedIn: true, role: UserRole.User };
		const filters = postListFilters(ctx);
		expect(filters.postCondition).toBe("p.invisible = 0");
		expect(filters.threadCondition).toBe("t.sticky >= 0");
		expect(filters.forumCondition).toBe("f.status = 1");
		expect(filters.forumVisibility).toContain("members");
	});
});

// ─── Status Constants ──────────────────────────────────────

describe("status constants", () => {
	it("ThreadStickyLevel values are correct", () => {
		expect(ThreadStickyLevel.NORMAL).toBe(0);
		expect(ThreadStickyLevel.DELETED).toBe(-2);
		expect(ThreadStickyLevel.STICKY_GLOBAL).toBe(3);
	});

	it("PostInvisibleLevel values are correct", () => {
		expect(PostInvisibleLevel.VISIBLE).toBe(0);
		expect(PostInvisibleLevel.DELETED).toBe(1);
	});

	it("UserStatusLevel values are correct", () => {
		expect(UserStatusLevel.BANNED).toBe(-1);
		expect(UserStatusLevel.NORMAL).toBe(0);
	});

	it("ForumStatusLevel values are correct", () => {
		expect(ForumStatusLevel.ACTIVE).toBe(1);
		expect(ForumStatusLevel.DELETED).toBe(-1);
	});
});
