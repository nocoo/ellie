import { UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";
import {
	FORUM_ACTIVE,
	POST_VISIBLE,
	THREAD_VISIBLE,
	USER_ACTIVE,
	buildForumFilter,
	buildForumVisibilityFilter,
	buildVisibilityContext,
	canViewForumVisibility,
	forumActive,
	postVisible,
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
