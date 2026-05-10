import {
	checkCanDeleteThread,
	checkCanManageThread,
	checkCanModerate,
	checkCanMoveThread,
	checkCanReply,
	enrichPosts,
	floorLabel,
	formatDate,
	formatDateTime,
	formatFileSize,
	groupAttachmentsByPostId,
	groupCommentsByPostId,
	uniqueAuthorIds,
} from "@/viewmodels/forum/thread-detail";
import type { Attachment, Post, PostComment, Thread, User } from "@ellie/types";
import { UserRole, UserStatus } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> & { id: number }): User {
	return {
		username: "testuser",
		email: "",
		avatar: "",
		status: UserStatus.Active,
		role: UserRole.User,
		regDate: 1710000000,
		lastLogin: 1710000000,
		threads: 10,
		posts: 50,
		credits: 100,
		signature: "",
		groupTitle: "",
		groupStars: 0,
		groupColor: "",
		customTitle: "",
		digestPosts: 0,
		olTime: 0,
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		lastActivity: 0,
		emailVerifiedAt: 0,
		emailNormalized: "",
		emailChangedAt: 0,
		...overrides,
	};
}

function makePost(overrides: Partial<Post> & { id: number }): Post {
	return {
		threadId: 1,
		forumId: 10,
		authorId: 1,
		authorName: "testuser",
		content: "<p>Test content</p>",
		createdAt: 1711600000,
		isFirst: false,
		position: 1,
		...overrides,
	};
}

function makeAttachment(overrides: Partial<Attachment> & { id: number }): Attachment {
	return {
		threadId: 1,
		postId: 1,
		authorId: 1,
		filename: "test.pdf",
		filePath: "/files/test.pdf",
		fileSize: 1024,
		isImage: false,
		width: 0,
		hasThumb: false,
		downloads: 0,
		createdAt: 1711600000,
		...overrides,
	};
}

function makeThread(overrides: Partial<Thread> & { id: number }): Thread {
	return {
		forumId: 10,
		authorId: 1,
		authorName: "testuser",
		authorAvatar: "",
		subject: "Test thread",
		createdAt: 1711600000,
		lastPostAt: 1711610000,
		lastPoster: "testuser",
		lastPosterId: 1,
		lastPosterAvatar: "",
		replies: 0,
		views: 100,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// uniqueAuthorIds
// ---------------------------------------------------------------------------

describe("uniqueAuthorIds", () => {
	it("returns empty array for empty posts", () => {
		expect(uniqueAuthorIds([])).toEqual([]);
	});

	it("returns unique author IDs", () => {
		const posts = [
			makePost({ id: 1, authorId: 10 }),
			makePost({ id: 2, authorId: 20 }),
			makePost({ id: 3, authorId: 10 }),
		];
		const ids = uniqueAuthorIds(posts);
		expect(ids.sort()).toEqual([10, 20]);
	});

	it("returns single ID for single post", () => {
		const posts = [makePost({ id: 1, authorId: 42 })];
		expect(uniqueAuthorIds(posts)).toEqual([42]);
	});
});

// ---------------------------------------------------------------------------
// groupAttachmentsByPostId
// ---------------------------------------------------------------------------

describe("groupAttachmentsByPostId", () => {
	it("returns empty map for no attachments", () => {
		const map = groupAttachmentsByPostId([]);
		expect(map.size).toBe(0);
	});

	it("groups attachments by postId", () => {
		const atts = [
			makeAttachment({ id: 1, postId: 10 }),
			makeAttachment({ id: 2, postId: 10 }),
			makeAttachment({ id: 3, postId: 20 }),
		];
		const map = groupAttachmentsByPostId(atts);
		expect(map.get(10)?.length).toBe(2);
		expect(map.get(20)?.length).toBe(1);
		expect(map.has(30)).toBe(false);
	});

	it("returns correct map for single attachment", () => {
		const atts = [makeAttachment({ id: 1, postId: 5 })];
		const map = groupAttachmentsByPostId(atts);
		expect(map.size).toBe(1);
		expect(map.get(5)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// groupCommentsByPostId
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<PostComment> & { id: number }): PostComment {
	return {
		threadId: 1,
		postId: 1,
		authorId: 1,
		authorName: "commenter",
		content: "Test comment",
		score: 0,
		replyPostId: 0,
		createdAt: 1711600000,
		...overrides,
	};
}

describe("groupCommentsByPostId", () => {
	it("returns empty map for no comments", () => {
		const map = groupCommentsByPostId([]);
		expect(map.size).toBe(0);
	});

	it("groups comments by postId", () => {
		const comments = [
			makeComment({ id: 1, postId: 10 }),
			makeComment({ id: 2, postId: 10 }),
			makeComment({ id: 3, postId: 20 }),
		];
		const map = groupCommentsByPostId(comments);
		expect(map.get(10)?.length).toBe(2);
		expect(map.get(20)?.length).toBe(1);
		expect(map.has(30)).toBe(false);
	});

	it("returns correct map for single comment", () => {
		const comments = [makeComment({ id: 1, postId: 5 })];
		const map = groupCommentsByPostId(comments);
		expect(map.size).toBe(1);
		expect(map.get(5)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// enrichPosts
// ---------------------------------------------------------------------------

describe("enrichPosts", () => {
	it("enriches posts with author, attachments, and comments", () => {
		const user = makeUser({ id: 1, username: "alice" });
		const authorMap = new Map([[1, user]]);
		const attachmentMap = new Map([[100, [makeAttachment({ id: 1, postId: 100 })]]]);
		const commentMap = new Map([[100, [makeComment({ id: 1, postId: 100 })]]]);
		const posts = [makePost({ id: 100, authorId: 1 })];

		const enriched = enrichPosts(posts, authorMap, attachmentMap, commentMap, null, {
			moderators: "",
		});
		expect(enriched.length).toBe(1);
		expect(enriched[0]?.author?.username).toBe("alice");
		expect(enriched[0]?.attachments.length).toBe(1);
		expect(enriched[0]?.comments.length).toBe(1);
	});

	it("handles missing author gracefully", () => {
		const posts = [makePost({ id: 1, authorId: 999 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), null, {
			moderators: "",
		});
		expect(enriched[0]?.author).toBeNull();
		expect(enriched[0]?.attachments).toEqual([]);
		expect(enriched[0]?.comments).toEqual([]);
	});

	it("computes canDelete for own post", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), currentUser, {
			moderators: "",
		});
		expect(enriched[0]?.canDelete).toBe(true);
	});

	it("cannot delete others post as regular user", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 2 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), currentUser, {
			moderators: "",
		});
		expect(enriched[0]?.canDelete).toBe(false);
	});

	it("admin can delete any post", () => {
		const admin = makeUser({ id: 99, role: UserRole.Admin });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), admin, {
			moderators: "",
		});
		expect(enriched[0]?.canDelete).toBe(true);
	});

	it("computes canEdit for own post", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), currentUser, {
			moderators: "",
		});
		expect(enriched[0]?.canEdit).toBe(true);
	});

	it("cannot edit others post as regular user", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 2 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), currentUser, {
			moderators: "",
		});
		expect(enriched[0]?.canEdit).toBe(false);
	});

	it("mod can edit posts in their moderated forum", () => {
		const mod = makeUser({ id: 50, role: UserRole.Mod, username: "moderator" });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), mod, {
			moderators: "moderator",
		});
		expect(enriched[0]?.canEdit).toBe(true);
	});

	it("super mod can delete any post", () => {
		const superMod = makeUser({ id: 50, role: UserRole.SuperMod });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), superMod, {
			moderators: "",
		});
		expect(enriched[0]?.canDelete).toBe(true);
	});

	it("filters author signature through filterContent", () => {
		const user = makeUser({ id: 1, signature: "<p>My signature</p>" });
		const authorMap = new Map([[1, user]]);
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, authorMap, new Map(), new Map(), null, {
			moderators: "",
		});
		expect(enriched[0]?.author).not.toBeNull();
		// Signature should pass through filterContent
		expect(enriched[0]?.author?.signature).toContain("My signature");
	});

	it("handles author with null signature", () => {
		const user = makeUser({ id: 1, signature: "" });
		const authorMap = new Map([[1, user]]);
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, authorMap, new Map(), new Map(), null, {
			moderators: "",
		});
		expect(enriched[0]?.author).not.toBeNull();
	});

	it("handles null currentUser", () => {
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), new Map(), null, {
			moderators: "",
		});
		expect(enriched[0]?.canDelete).toBe(false);
		expect(enriched[0]?.canEdit).toBe(false);
	});

	it("returns empty array for empty posts", () => {
		const enriched = enrichPosts([], new Map(), new Map(), new Map(), null, { moderators: "" });
		expect(enriched).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// checkCanReply
// ---------------------------------------------------------------------------

describe("checkCanReply", () => {
	it("returns false for null user", () => {
		const thread = makeThread({ id: 1, closed: 0 });
		expect(checkCanReply(null, thread)).toBe(false);
	});

	it("returns true for active user and open thread", () => {
		const user = makeUser({ id: 1, status: UserStatus.Active });
		const thread = makeThread({ id: 1, closed: 0 });
		expect(checkCanReply(user, thread)).toBe(true);
	});

	it("returns false for closed thread", () => {
		const user = makeUser({ id: 1, status: UserStatus.Active });
		const thread = makeThread({ id: 1, closed: 1 });
		expect(checkCanReply(user, thread)).toBe(false);
	});

	it("returns false for banned user", () => {
		const user = makeUser({ id: 1, status: UserStatus.Banned });
		const thread = makeThread({ id: 1, closed: 0 });
		expect(checkCanReply(user, thread)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkCanModerate
// ---------------------------------------------------------------------------

describe("checkCanModerate", () => {
	it("returns false for null user", () => {
		expect(checkCanModerate(null, { moderators: "" })).toBe(false);
	});

	it("returns true for admin", () => {
		const admin = makeUser({ id: 1, role: UserRole.Admin });
		expect(checkCanModerate(admin, { moderators: "" })).toBe(true);
	});

	it("returns true for super mod", () => {
		const superMod = makeUser({ id: 1, role: UserRole.SuperMod });
		expect(checkCanModerate(superMod, { moderators: "" })).toBe(true);
	});

	it("returns true for mod in their forum", () => {
		const mod = makeUser({ id: 1, role: UserRole.Mod, username: "alice" });
		expect(checkCanModerate(mod, { moderators: "alice" })).toBe(true);
	});

	it("returns false for mod not in forum moderators", () => {
		const mod = makeUser({ id: 1, role: UserRole.Mod, username: "alice" });
		expect(checkCanModerate(mod, { moderators: "bob" })).toBe(false);
	});

	it("returns false for regular user", () => {
		const user = makeUser({ id: 1, role: UserRole.User });
		expect(checkCanModerate(user, { moderators: "" })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkCanManageThread
// ---------------------------------------------------------------------------

describe("checkCanManageThread", () => {
	it("returns false for null user", () => {
		expect(checkCanManageThread(null, { moderators: "" })).toBe(false);
	});

	it("returns true for admin", () => {
		const admin = makeUser({ id: 1, role: UserRole.Admin });
		expect(checkCanManageThread(admin, { moderators: "" })).toBe(true);
	});

	it("returns false for regular user", () => {
		const user = makeUser({ id: 1, role: UserRole.User });
		expect(checkCanManageThread(user, { moderators: "" })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkCanMoveThread
// ---------------------------------------------------------------------------

describe("checkCanMoveThread", () => {
	it("returns false for null user", () => {
		expect(checkCanMoveThread(null)).toBe(false);
	});

	it("returns true for admin", () => {
		const admin = makeUser({ id: 1, role: UserRole.Admin });
		expect(checkCanMoveThread(admin)).toBe(true);
	});

	it("returns true for super mod", () => {
		const superMod = makeUser({ id: 1, role: UserRole.SuperMod });
		expect(checkCanMoveThread(superMod)).toBe(true);
	});

	it("returns false for regular user", () => {
		const user = makeUser({ id: 1, role: UserRole.User });
		expect(checkCanMoveThread(user)).toBe(false);
	});

	it("returns false for mod", () => {
		const mod = makeUser({ id: 1, role: UserRole.Mod });
		expect(checkCanMoveThread(mod)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkCanDeleteThread
// ---------------------------------------------------------------------------

describe("checkCanDeleteThread", () => {
	it("returns false for null user", () => {
		expect(checkCanDeleteThread(null, { authorId: 1 }, { moderators: "" })).toBe(false);
	});

	it("returns true for thread author", () => {
		const user = makeUser({ id: 1, role: UserRole.User });
		expect(checkCanDeleteThread(user, { authorId: 1 }, { moderators: "" })).toBe(true);
	});

	it("returns false for non-author regular user", () => {
		const user = makeUser({ id: 2, role: UserRole.User });
		expect(checkCanDeleteThread(user, { authorId: 1 }, { moderators: "" })).toBe(false);
	});

	it("returns true for admin deleting others thread", () => {
		const admin = makeUser({ id: 99, role: UserRole.Admin });
		expect(checkCanDeleteThread(admin, { authorId: 1 }, { moderators: "" })).toBe(true);
	});

	it("returns true for super mod deleting others thread", () => {
		const superMod = makeUser({ id: 99, role: UserRole.SuperMod });
		expect(checkCanDeleteThread(superMod, { authorId: 1 }, { moderators: "" })).toBe(true);
	});

	it("returns false for mod deleting others thread", () => {
		const mod = makeUser({ id: 99, role: UserRole.Mod });
		expect(checkCanDeleteThread(mod, { authorId: 1 }, { moderators: "mod" })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// floorLabel
// ---------------------------------------------------------------------------

describe("floorLabel", () => {
	it("returns 楼主 for first post", () => {
		expect(floorLabel(1, true)).toBe("楼主");
	});

	it("returns position + 楼 for other posts", () => {
		expect(floorLabel(2, false)).toBe("2 楼");
		expect(floorLabel(10, false)).toBe("10 楼");
	});
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe("formatFileSize", () => {
	it("formats bytes", () => {
		expect(formatFileSize(0)).toBe("0 B");
		expect(formatFileSize(500)).toBe("500 B");
	});

	it("formats kilobytes", () => {
		expect(formatFileSize(1024)).toBe("1.0 KB");
		expect(formatFileSize(1500)).toBe("1.5 KB");
	});

	it("formats megabytes", () => {
		expect(formatFileSize(1048576)).toBe("1.0 MB");
		expect(formatFileSize(2621440)).toBe("2.5 MB");
	});

	it("formats boundary values", () => {
		expect(formatFileSize(1023)).toBe("1023 B");
		expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
	});
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatDate(0)).toBe("");
	});

	it("formats timestamp to absolute date without zero-padding", () => {
		// 2003-07-14 00:00:00 UTC
		const ts = new Date(2003, 6, 14).getTime() / 1000;
		expect(formatDate(ts)).toBe("2003-7-14");
	});

	it("formats single-digit month and day", () => {
		// 2020-01-05 00:00:00
		const ts = new Date(2020, 0, 5).getTime() / 1000;
		expect(formatDate(ts)).toBe("2020-1-5");
	});
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatDateTime(0)).toBe("");
	});

	it("formats timestamp to absolute date-time with zero-padded minutes", () => {
		// 2013-05-19 23:40:00
		const ts = new Date(2013, 4, 19, 23, 40).getTime() / 1000;
		expect(formatDateTime(ts)).toBe("2013-5-19 23:40");
	});

	it("zero-pads single-digit minutes", () => {
		// 2023-12-01 9:05:00
		const ts = new Date(2023, 11, 1, 9, 5).getTime() / 1000;
		expect(formatDateTime(ts)).toBe("2023-12-1 09:05");
	});

	it("formats midnight correctly", () => {
		const ts = new Date(2026, 0, 1, 0, 0).getTime() / 1000;
		expect(formatDateTime(ts)).toBe("2026-1-1 00:00");
	});
});
