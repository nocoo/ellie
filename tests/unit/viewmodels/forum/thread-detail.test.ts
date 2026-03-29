import { describe, expect, it } from "bun:test";
import {
	enrichPosts,
	floorLabel,
	formatFileSize,
	groupAttachmentsByPostId,
	uniqueAuthorIds,
} from "../../../../apps/web/src/viewmodels/forum/thread-detail";
import type { Attachment, Post, User } from "../../../../packages/types/src/types";
import { UserRole } from "../../../../packages/types/src/types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> & { id: number }): User {
	return {
		username: "testuser",
		email: "",
		avatar: "",
		status: 0,
		role: UserRole.User,
		regDate: 1710000000,
		lastLogin: 1710000000,
		threads: 10,
		posts: 50,
		credits: 100,
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
});

// ---------------------------------------------------------------------------
// enrichPosts
// ---------------------------------------------------------------------------

describe("enrichPosts", () => {
	it("enriches posts with author and attachments", () => {
		const user = makeUser({ id: 1, username: "alice" });
		const authorMap = new Map([[1, user]]);
		const attachmentMap = new Map([[100, [makeAttachment({ id: 1, postId: 100 })]]]);
		const posts = [makePost({ id: 100, authorId: 1 })];

		const enriched = enrichPosts(posts, authorMap, attachmentMap, null, 10);
		expect(enriched.length).toBe(1);
		expect(enriched[0]?.author?.username).toBe("alice");
		expect(enriched[0]?.attachments.length).toBe(1);
	});

	it("handles missing author gracefully", () => {
		const posts = [makePost({ id: 1, authorId: 999 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), null, 10);
		expect(enriched[0]?.author).toBeNull();
		expect(enriched[0]?.attachments).toEqual([]);
	});

	it("computes canDelete for own post", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), currentUser, 10);
		expect(enriched[0]?.canDelete).toBe(true);
	});

	it("cannot delete others post as regular user", () => {
		const currentUser = makeUser({ id: 1, role: UserRole.User });
		const posts = [makePost({ id: 1, authorId: 2 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), currentUser, 10);
		expect(enriched[0]?.canDelete).toBe(false);
	});

	it("admin can delete any post", () => {
		const admin = makeUser({ id: 99, role: UserRole.Admin });
		const posts = [makePost({ id: 1, authorId: 1 })];
		const enriched = enrichPosts(posts, new Map(), new Map(), admin, 10);
		expect(enriched[0]?.canDelete).toBe(true);
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
});
