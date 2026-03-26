import { describe, expect, test } from "bun:test";
import {
	canAccessAdmin,
	canCreateThread,
	canDeletePost,
	canManageUsers,
	canModerate,
	canReplyToThread,
	canViewForum,
} from "@/models/permission";
import type { Forum, Post, Thread, User } from "@/models/types";
import { ForumType, StickyLevel, UserRole, UserStatus } from "@/models/types";

// ─── Test Fixtures ──────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 1,
		username: "testuser",
		email: "test@example.com",
		avatar: "",
		status: UserStatus.Active,
		role: UserRole.User,
		regDate: 1000000,
		lastLogin: 2000000,
		threads: 0,
		posts: 0,
		credits: 0,
		...overrides,
	};
}

function makeForum(overrides: Partial<Forum> = {}): Forum {
	return {
		id: 1,
		parentId: 0,
		name: "Test Forum",
		description: "",
		icon: "",
		displayOrder: 0,
		threads: 0,
		posts: 0,
		type: ForumType.Forum,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		...overrides,
	};
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		id: 1,
		forumId: 1,
		authorId: 1,
		authorName: "testuser",
		subject: "Test Thread",
		createdAt: 1000000,
		lastPostAt: 2000000,
		lastPoster: "testuser",
		replies: 0,
		views: 0,
		closed: 0,
		sticky: StickyLevel.None,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		...overrides,
	};
}

function makePost(overrides: Partial<Post> = {}): Post {
	return {
		id: 1,
		threadId: 1,
		forumId: 1,
		authorId: 1,
		authorName: "testuser",
		content: "test content",
		createdAt: 1000000,
		isFirst: false,
		position: 1,
		...overrides,
	};
}

const ALL_ROLES = [UserRole.User, UserRole.Admin, UserRole.SuperMod, UserRole.Mod] as const;

const ALL_STATUSES = [UserStatus.Active, UserStatus.Banned, UserStatus.Archived] as const;

// ─── canViewForum ───────────────────────────────────────

describe("canViewForum", () => {
	test("visible forum (status=1) is viewable by anyone including null", () => {
		const forum = makeForum({ status: 1 });
		expect(canViewForum(null, forum)).toBe(true);
		for (const role of ALL_ROLES) {
			expect(canViewForum(makeUser({ role }), forum)).toBe(true);
		}
	});

	test("hidden forum (status=0) is not viewable by anyone", () => {
		const forum = makeForum({ status: 0 });
		expect(canViewForum(null, forum)).toBe(false);
		for (const role of ALL_ROLES) {
			expect(canViewForum(makeUser({ role }), forum)).toBe(false);
		}
	});
});

// ─── canCreateThread ────────────────────────────────────

describe("canCreateThread", () => {
	const forum = makeForum();

	test("null user cannot create thread", () => {
		expect(canCreateThread(null, forum)).toBe(false);
	});

	test("active users of any role can create thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Active });
			expect(canCreateThread(user, forum)).toBe(true);
		}
	});

	test("banned users cannot create thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Banned });
			expect(canCreateThread(user, forum)).toBe(false);
		}
	});

	test("archived users cannot create thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Archived });
			expect(canCreateThread(user, forum)).toBe(false);
		}
	});
});

// ─── canReplyToThread ───────────────────────────────────

describe("canReplyToThread", () => {
	test("null user cannot reply", () => {
		expect(canReplyToThread(null, makeThread())).toBe(false);
	});

	test("active user can reply to open thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Active });
			expect(canReplyToThread(user, makeThread({ closed: 0 }))).toBe(true);
		}
	});

	test("active user cannot reply to closed thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Active });
			expect(canReplyToThread(user, makeThread({ closed: 1 }))).toBe(false);
		}
	});

	test("banned user cannot reply even to open thread", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Banned });
			expect(canReplyToThread(user, makeThread({ closed: 0 }))).toBe(false);
		}
	});

	test("archived user cannot reply", () => {
		for (const role of ALL_ROLES) {
			const user = makeUser({ role, status: UserStatus.Archived });
			expect(canReplyToThread(user, makeThread({ closed: 0 }))).toBe(false);
		}
	});
});

// ─── canModerate ────────────────────────────────────────

describe("canModerate", () => {
	test("null user cannot moderate", () => {
		expect(canModerate(null, 1)).toBe(false);
	});

	test("Admin can moderate any forum", () => {
		expect(canModerate(makeUser({ role: UserRole.Admin }), 1)).toBe(true);
		expect(canModerate(makeUser({ role: UserRole.Admin }), 999)).toBe(true);
	});

	test("SuperMod can moderate any forum", () => {
		expect(canModerate(makeUser({ role: UserRole.SuperMod }), 1)).toBe(true);
	});

	test("Mod can moderate (simplified: all forums)", () => {
		expect(canModerate(makeUser({ role: UserRole.Mod }), 1)).toBe(true);
	});

	test("regular User cannot moderate", () => {
		expect(canModerate(makeUser({ role: UserRole.User }), 1)).toBe(false);
	});
});

// ─── canAccessAdmin ─────────────────────────────────────

describe("canAccessAdmin", () => {
	test("null user cannot access admin", () => {
		expect(canAccessAdmin(null)).toBe(false);
	});

	test("Admin can access admin", () => {
		expect(canAccessAdmin(makeUser({ role: UserRole.Admin }))).toBe(true);
	});

	test("SuperMod can access admin", () => {
		expect(canAccessAdmin(makeUser({ role: UserRole.SuperMod }))).toBe(true);
	});

	test("Mod cannot access admin", () => {
		expect(canAccessAdmin(makeUser({ role: UserRole.Mod }))).toBe(false);
	});

	test("User cannot access admin", () => {
		expect(canAccessAdmin(makeUser({ role: UserRole.User }))).toBe(false);
	});
});

// ─── canManageUsers ─────────────────────────────────────

describe("canManageUsers", () => {
	test("null user cannot manage users", () => {
		expect(canManageUsers(null)).toBe(false);
	});

	test("only Admin can manage users", () => {
		expect(canManageUsers(makeUser({ role: UserRole.Admin }))).toBe(true);
	});

	test("SuperMod cannot manage users", () => {
		expect(canManageUsers(makeUser({ role: UserRole.SuperMod }))).toBe(false);
	});

	test("Mod cannot manage users", () => {
		expect(canManageUsers(makeUser({ role: UserRole.Mod }))).toBe(false);
	});

	test("User cannot manage users", () => {
		expect(canManageUsers(makeUser({ role: UserRole.User }))).toBe(false);
	});
});

// ─── canDeletePost ──────────────────────────────────────

describe("canDeletePost", () => {
	test("null user cannot delete any post", () => {
		expect(canDeletePost(null, makePost(), 1)).toBe(false);
	});

	test("author can delete their own post", () => {
		const user = makeUser({ id: 42, role: UserRole.User });
		const post = makePost({ authorId: 42 });
		expect(canDeletePost(user, post, 1)).toBe(true);
	});

	test("non-author regular user cannot delete others' posts", () => {
		const user = makeUser({ id: 42, role: UserRole.User });
		const post = makePost({ authorId: 99 });
		expect(canDeletePost(user, post, 1)).toBe(false);
	});

	test("Admin can delete any post", () => {
		const user = makeUser({ id: 1, role: UserRole.Admin });
		const post = makePost({ authorId: 99 });
		expect(canDeletePost(user, post, 1)).toBe(true);
	});

	test("SuperMod can delete any post", () => {
		const user = makeUser({ id: 1, role: UserRole.SuperMod });
		const post = makePost({ authorId: 99 });
		expect(canDeletePost(user, post, 1)).toBe(true);
	});

	test("Mod can delete any post (simplified)", () => {
		const user = makeUser({ id: 1, role: UserRole.Mod });
		const post = makePost({ authorId: 99 });
		expect(canDeletePost(user, post, 1)).toBe(true);
	});
});

// ─── Full role × status matrix for canCreateThread ──────

describe("permission matrix: role × status", () => {
	const forum = makeForum();

	for (const role of ALL_ROLES) {
		for (const status of ALL_STATUSES) {
			const roleName = UserRole[role];
			const statusName = UserStatus[status] ?? `status=${status}`;
			const expected = status === UserStatus.Active;

			test(`canCreateThread: ${roleName} + ${statusName} → ${expected}`, () => {
				const user = makeUser({ role, status });
				expect(canCreateThread(user, forum)).toBe(expected);
			});
		}
	}
});
