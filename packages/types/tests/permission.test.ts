import { UserRole, UserStatus } from "@ellie/types";
import type {
	PermissionForum,
	PermissionPost,
	PermissionThread,
	PermissionUser,
} from "@ellie/types";
import {
	canAccessAdmin,
	canCreateThread,
	canDeletePost,
	canDeleteThread,
	canEditPost,
	canManageThread,
	canManageUsers,
	canModerate,
	canMoveThread,
	canReplyToThread,
	canViewForum,
} from "@ellie/types";
import type { Forum } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const activeUser: PermissionUser = {
	id: 1,
	username: "alice",
	role: UserRole.User,
	status: UserStatus.Active,
};
const bannedUser: PermissionUser = {
	id: 2,
	username: "banned",
	role: UserRole.User,
	status: UserStatus.Banned,
};
const admin: PermissionUser = {
	id: 10,
	username: "admin",
	role: UserRole.Admin,
	status: UserStatus.Active,
};
const superMod: PermissionUser = {
	id: 11,
	username: "supermod",
	role: UserRole.SuperMod,
	status: UserStatus.Active,
};
const mod: PermissionUser = {
	id: 12,
	username: "mod1",
	role: UserRole.Mod,
	status: UserStatus.Active,
};
const modNotInForum: PermissionUser = {
	id: 13,
	username: "mod2",
	role: UserRole.Mod,
	status: UserStatus.Active,
};

const forumWithMod: PermissionForum = { moderators: "mod1, mod3" };
const forumNoMods: PermissionForum = { moderators: "" };

const ownPost: PermissionPost = { id: 100, authorId: 1 };
const otherPost: PermissionPost = { id: 101, authorId: 99 };

const openThread: PermissionThread = { id: 200, authorId: 1, closed: 0 };
const closedThread: PermissionThread = { id: 201, authorId: 1, closed: 1 };
const otherThread = { authorId: 99 };

// Minimal Forum object for canViewForum / canCreateThread
const activeForum = { status: 1 } as Forum;
const hiddenForum = { status: 0 } as Forum;

// ---------------------------------------------------------------------------
// canViewForum (deprecated — status-only check)
// ---------------------------------------------------------------------------

describe("canViewForum", () => {
	it("returns true for active forum", () => {
		expect(canViewForum(null, activeForum)).toBe(true);
		expect(canViewForum(activeUser, activeForum)).toBe(true);
	});

	it("returns false for hidden forum (status 0)", () => {
		expect(canViewForum(null, hiddenForum)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canCreateThread
// ---------------------------------------------------------------------------

describe("canCreateThread", () => {
	it("returns false for anonymous", () => {
		expect(canCreateThread(null, activeForum)).toBe(false);
	});

	it("returns true for active user", () => {
		expect(canCreateThread(activeUser, activeForum)).toBe(true);
	});

	it("returns false for banned user", () => {
		expect(canCreateThread(bannedUser, activeForum)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canReplyToThread
// ---------------------------------------------------------------------------

describe("canReplyToThread", () => {
	it("returns false for anonymous", () => {
		expect(canReplyToThread(null, openThread)).toBe(false);
	});

	it("returns true for active user on open thread", () => {
		expect(canReplyToThread(activeUser, openThread)).toBe(true);
	});

	it("returns false for active user on closed thread", () => {
		expect(canReplyToThread(activeUser, closedThread)).toBe(false);
	});

	it("returns false for banned user", () => {
		expect(canReplyToThread(bannedUser, openThread)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canModerate
// ---------------------------------------------------------------------------

describe("canModerate", () => {
	it("returns false for anonymous", () => {
		expect(canModerate(null, forumWithMod)).toBe(false);
	});

	it("returns false for regular user", () => {
		expect(canModerate(activeUser, forumWithMod)).toBe(false);
	});

	it("returns true for admin in any forum", () => {
		expect(canModerate(admin, forumNoMods)).toBe(true);
	});

	it("returns true for supermod in any forum", () => {
		expect(canModerate(superMod, forumNoMods)).toBe(true);
	});

	it("returns true for mod listed in forum moderators", () => {
		expect(canModerate(mod, forumWithMod)).toBe(true);
	});

	it("returns false for mod NOT listed in forum moderators", () => {
		expect(canModerate(modNotInForum, forumWithMod)).toBe(false);
	});

	it("returns false for mod when forum has no moderators", () => {
		expect(canModerate(mod, forumNoMods)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canAccessAdmin
// ---------------------------------------------------------------------------

describe("canAccessAdmin", () => {
	it("returns false for anonymous", () => {
		expect(canAccessAdmin(null)).toBe(false);
	});

	it("returns false for regular user", () => {
		expect(canAccessAdmin(activeUser)).toBe(false);
	});

	it("returns false for mod", () => {
		expect(canAccessAdmin(mod)).toBe(false);
	});

	it("returns true for admin", () => {
		expect(canAccessAdmin(admin)).toBe(true);
	});

	it("returns true for supermod", () => {
		expect(canAccessAdmin(superMod)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// canManageUsers
// ---------------------------------------------------------------------------

describe("canManageUsers", () => {
	it("returns false for anonymous", () => {
		expect(canManageUsers(null)).toBe(false);
	});

	it("returns false for regular user", () => {
		expect(canManageUsers(activeUser)).toBe(false);
	});

	it("returns false for supermod", () => {
		expect(canManageUsers(superMod)).toBe(false);
	});

	it("returns true for admin only", () => {
		expect(canManageUsers(admin)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// canEditPost
// ---------------------------------------------------------------------------

describe("canEditPost", () => {
	it("returns false for anonymous", () => {
		expect(canEditPost(null, otherPost, forumWithMod)).toBe(false);
	});

	it("allows author to edit own post", () => {
		expect(canEditPost(activeUser, ownPost, forumNoMods)).toBe(true);
	});

	it("denies user editing others' post", () => {
		expect(canEditPost(activeUser, otherPost, forumNoMods)).toBe(false);
	});

	it("allows admin to edit any post", () => {
		expect(canEditPost(admin, otherPost, forumNoMods)).toBe(true);
	});

	it("allows supermod to edit any post", () => {
		expect(canEditPost(superMod, otherPost, forumNoMods)).toBe(true);
	});

	it("allows mod to edit post in their forum", () => {
		expect(canEditPost(mod, otherPost, forumWithMod)).toBe(true);
	});

	it("denies mod editing post in other forum", () => {
		expect(canEditPost(modNotInForum, otherPost, forumWithMod)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canDeletePost
// ---------------------------------------------------------------------------

describe("canDeletePost", () => {
	it("returns false for anonymous", () => {
		expect(canDeletePost(null, otherPost, forumWithMod)).toBe(false);
	});

	it("allows author to delete own post", () => {
		expect(canDeletePost(activeUser, ownPost, forumNoMods)).toBe(true);
	});

	it("denies user deleting others' post", () => {
		expect(canDeletePost(activeUser, otherPost, forumNoMods)).toBe(false);
	});

	it("allows admin to delete any post", () => {
		expect(canDeletePost(admin, otherPost, forumNoMods)).toBe(true);
	});

	it("allows supermod to delete any post", () => {
		expect(canDeletePost(superMod, otherPost, forumNoMods)).toBe(true);
	});

	it("mod CANNOT delete others' post (per permission matrix)", () => {
		expect(canDeletePost(mod, otherPost, forumWithMod)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canDeleteThread
// ---------------------------------------------------------------------------

describe("canDeleteThread", () => {
	it("returns false for anonymous", () => {
		expect(canDeleteThread(null, otherThread, forumWithMod)).toBe(false);
	});

	it("allows author to delete own thread", () => {
		expect(canDeleteThread(activeUser, { authorId: 1 }, forumNoMods)).toBe(true);
	});

	it("denies user deleting others' thread", () => {
		expect(canDeleteThread(activeUser, otherThread, forumNoMods)).toBe(false);
	});

	it("allows admin to delete any thread", () => {
		expect(canDeleteThread(admin, otherThread, forumNoMods)).toBe(true);
	});

	it("allows supermod to delete any thread", () => {
		expect(canDeleteThread(superMod, otherThread, forumNoMods)).toBe(true);
	});

	it("mod CANNOT delete others' thread (per permission matrix)", () => {
		expect(canDeleteThread(mod, otherThread, forumWithMod)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canManageThread (delegates to canModerate)
// ---------------------------------------------------------------------------

describe("canManageThread", () => {
	it("returns false for regular user", () => {
		expect(canManageThread(activeUser, forumWithMod)).toBe(false);
	});

	it("returns true for admin", () => {
		expect(canManageThread(admin, forumNoMods)).toBe(true);
	});

	it("returns true for mod in their forum", () => {
		expect(canManageThread(mod, forumWithMod)).toBe(true);
	});

	it("returns false for mod not in forum", () => {
		expect(canManageThread(modNotInForum, forumWithMod)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canMoveThread
// ---------------------------------------------------------------------------

describe("canMoveThread", () => {
	it("returns false for anonymous", () => {
		expect(canMoveThread(null)).toBe(false);
	});

	it("returns false for regular user", () => {
		expect(canMoveThread(activeUser)).toBe(false);
	});

	it("returns false for mod (per permission matrix)", () => {
		expect(canMoveThread(mod)).toBe(false);
	});

	it("returns true for admin", () => {
		expect(canMoveThread(admin)).toBe(true);
	});

	it("returns true for supermod", () => {
		expect(canMoveThread(superMod)).toBe(true);
	});
});
