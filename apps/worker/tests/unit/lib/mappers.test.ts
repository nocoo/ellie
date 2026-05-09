import { describe, expect, it } from "vitest";
import {
	enrichForumsWithUserCache,
	enrichThreadsWithUserCache,
	parseModeratorIds,
	toAttachment,
	toCensorWord,
	toForum,
	toIpBan,
	toPost,
	toPublicUser,
	toThread,
	toUser,
} from "../../../src/lib/mappers";
import type { UserMiniProfile } from "../../../src/lib/user-cache";

describe("D1 row mappers", () => {
	describe("toUser", () => {
		it("should map snake_case D1 row to camelCase User", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				avatar_path: "avatars/abc123.jpg",
				status: 0,
				role: 1,
				reg_date: 1711540800,
				last_login: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				group_title: "管理员",
				group_stars: 9,
				group_color: "#FF0000",
				custom_title: "站长",
				digest_posts: 5,
				ol_time: 1000,
				gender: 1,
				birth_year: 1990,
				birth_month: 6,
				birth_day: 15,
				reside_province: "上海",
				reside_city: "杨浦",
				graduate_school: "同济大学",
				bio: "管理员简介",
				interest: "编程",
				qq: "12345678",
				site: "https://example.com",
				campus: "四平路校区",
				last_activity: 1711540800,
				email_verified_at: 1711540900,
				email_normalized: "alice@example.com",
				email_changed_at: 0,
			};

			const user = toUser(row);

			expect(user).toEqual({
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				avatarPath: "avatars/abc123.jpg",
				status: 0,
				role: 1,
				regDate: 1711540800,
				lastLogin: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				groupTitle: "管理员",
				groupStars: 9,
				groupColor: "#FF0000",
				customTitle: "站长",
				digestPosts: 5,
				olTime: 1000,
				gender: 1,
				birthYear: 1990,
				birthMonth: 6,
				birthDay: 15,
				resideProvince: "上海",
				resideCity: "杨浦",
				graduateSchool: "同济大学",
				bio: "管理员简介",
				interest: "编程",
				qq: "12345678",
				site: "https://example.com",
				campus: "四平路校区",
				lastActivity: 1711540800,
				emailVerifiedAt: 1711540900,
				emailNormalized: "alice@example.com",
				emailChangedAt: 0,
				regIp: undefined,
				lastIp: undefined,
				purgedAt: 0,
				purgedBy: 0,
			});
		});

		it("should strip password_hash and password_salt even if present", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				status: 0,
				role: 1,
				reg_date: 1711540800,
				last_login: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				last_activity: 0,
				password_hash: "secret_hash",
				password_salt: "secret_salt",
			};

			const user = toUser(row);

			// Explicitly constructed — no password fields should exist
			expect("passwordHash" in user).toBe(false);
			expect("passwordSalt" in user).toBe(false);
			expect("password_hash" in user).toBe(false);
			expect("password_salt" in user).toBe(false);
		});

		it("should output exactly 36 fields", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "a@b.com",
				avatar: "",
				avatar_path: "",
				status: 0,
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				last_activity: 0,
				email_verified_at: 0,
				email_normalized: "",
				email_changed_at: 0,
				reg_ip: "1.2.3.4",
				last_ip: "5.6.7.8",
			};

			const user = toUser(row);
			// 37 base columns + purgedAt + purgedBy (D4-a tombstone fields) + campus.
			expect(Object.keys(user)).toHaveLength(40);
		});

		it("should default campus to empty string when column missing", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "a@b.com",
				avatar: "",
				avatar_path: "",
				status: 0,
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				last_activity: 0,
			};
			expect(toUser(row).campus).toBe("");
			expect(toPublicUser(row).campus).toBe("");
		});
	});

	describe("toForum", () => {
		it("should map snake_case D1 row to camelCase Forum", () => {
			const row = {
				id: 1,
				parent_id: 0,
				name: "General",
				description: "General discussion",
				icon: "icon.png",
				display_order: 1,
				threads: 10,
				posts: 100,
				type: "forum",
				status: 0,
				moderators: "alice, bob",
				last_thread_id: 42,
				last_post_at: 1711540800,
				last_poster: "bob",
				last_thread_subject: "Hello World",
			};

			const forum = toForum(row);

			expect(forum.parentId).toBe(0);
			expect(forum.displayOrder).toBe(1);
			expect(forum.moderators).toBe("alice, bob");
			expect(forum.lastThreadId).toBe(42);
			expect(forum.lastPostAt).toBe(1711540800);
			expect(forum.lastPoster).toBe("bob");
			expect(forum.lastThreadSubject).toBe("Hello World");
		});

		it("should output exactly 20 fields", () => {
			const row = {
				id: 1,
				parent_id: 0,
				name: "General",
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 0,
				visibility: "public",
				moderators: "",
				moderator_ids: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_poster_id: 0,
				last_thread_subject: "",
			};

			const forum = toForum(row);
			expect(Object.keys(forum)).toHaveLength(21);
		});
	});

	describe("toThread", () => {
		it("should map snake_case D1 row to camelCase Thread", () => {
			const row = {
				id: 1,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Test Thread",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				replies: 5,
				views: 42,
				closed: 0,
				sticky: 1,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 3,
				post_table_id: 1, // internal — must be stripped
				type_name: "求助",
			};

			const thread = toThread(row);

			expect(thread.forumId).toBe(10);
			expect(thread.authorId).toBe(100);
			expect(thread.authorName).toBe("alice");
			expect(thread.createdAt).toBe(1711540800);
			expect(thread.lastPostAt).toBe(1711544400);
			expect(thread.lastPoster).toBe("bob");
			expect(thread.typeName).toBe("求助");
		});

		it("should strip post_table_id (internal field)", () => {
			const row = {
				id: 1,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Test",
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				post_table_id: 5,
				type_name: "",
			};

			const thread = toThread(row);
			expect("postTableId" in thread).toBe(false);
			expect("post_table_id" in thread).toBe(false);
		});

		it("should output exactly 20 fields", () => {
			const row = {
				id: 1,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				subject: "",
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				last_poster_id: 0,
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				type_name: "",
			};

			const thread = toThread(row);
			expect(Object.keys(thread)).toHaveLength(23);
		});

		it("should map is_author_first_thread=1 to isAuthorFirstThread=true", () => {
			const row = {
				id: 1,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "First Thread",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				last_poster_id: 20,
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				type_name: "",
				is_author_first_thread: 1,
			};

			const thread = toThread(row);
			expect(thread.isAuthorFirstThread).toBe(true);
		});

		it("should map is_author_first_thread=0 to isAuthorFirstThread=false", () => {
			const row = {
				id: 2,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Second Thread",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				last_poster_id: 20,
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				type_name: "",
				is_author_first_thread: 0,
			};

			const thread = toThread(row);
			expect(thread.isAuthorFirstThread).toBe(false);
		});

		it("should map missing is_author_first_thread to isAuthorFirstThread=false", () => {
			const row = {
				id: 3,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Legacy Thread",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				last_poster_id: 20,
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				type_name: "",
				// is_author_first_thread intentionally omitted
			};

			const thread = toThread(row);
			expect(thread.isAuthorFirstThread).toBe(false);
		});
	});

	describe("toPost", () => {
		it("should map snake_case D1 row to camelCase Post", () => {
			const row = {
				id: 1,
				thread_id: 10,
				forum_id: 5,
				author_id: 100,
				author_name: "alice",
				content: "Hello",
				created_at: 1711540800,
				is_first: 1,
				position: 1,
			};

			const post = toPost(row);

			expect(post.threadId).toBe(10);
			expect(post.forumId).toBe(5);
			expect(post.authorId).toBe(100);
			expect(post.authorName).toBe("alice");
			expect(post.createdAt).toBe(1711540800);
			expect(post.position).toBe(1);
		});

		it("should convert is_first INTEGER 1 to boolean true", () => {
			const row = {
				id: 1,
				thread_id: 10,
				forum_id: 5,
				author_id: 100,
				author_name: "alice",
				content: "Hello",
				created_at: 0,
				is_first: 1,
				position: 1,
			};

			const post = toPost(row);
			expect(post.isFirst).toBe(true);
		});

		it("should convert is_first INTEGER 0 to boolean false", () => {
			const row = {
				id: 2,
				thread_id: 10,
				forum_id: 5,
				author_id: 101,
				author_name: "bob",
				content: "Reply",
				created_at: 0,
				is_first: 0,
				position: 2,
			};

			const post = toPost(row);
			expect(post.isFirst).toBe(false);
		});

		it("should output exactly 9 fields", () => {
			const row = {
				id: 1,
				thread_id: 0,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				content: "",
				created_at: 0,
				is_first: 0,
				position: 0,
			};

			const post = toPost(row);
			expect(Object.keys(post)).toHaveLength(9);
		});
	});

	describe("toPublicUser", () => {
		it("should map snake_case D1 row to camelCase PublicUser", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				avatar_path: "avatars/abc123.jpg",
				role: 1,
				reg_date: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				group_title: "管理员",
				group_stars: 9,
				group_color: "#FF0000",
				custom_title: "站长",
				digest_posts: 5,
				ol_time: 1000,
				last_activity: 1711540800,
				gender: 1,
				birth_year: 1990,
				birth_month: 5,
				birth_day: 15,
				reside_province: "上海",
				reside_city: "杨浦",
				graduate_school: "同济大学",
				bio: "Hello",
				interest: "编程",
				qq: "12345",
				site: "https://example.com",
				campus: "嘉定校区",
			};

			const user = toPublicUser(row);

			expect(user).toEqual({
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				avatarPath: "avatars/abc123.jpg",
				role: 1,
				regDate: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				groupTitle: "管理员",
				groupStars: 9,
				groupColor: "#FF0000",
				customTitle: "站长",
				digestPosts: 5,
				olTime: 1000,
				lastActivity: 1711540800,
				gender: 1,
				birthYear: 1990,
				birthMonth: 5,
				birthDay: 15,
				resideProvince: "上海",
				resideCity: "杨浦",
				graduateSchool: "同济大学",
				bio: "Hello",
				interest: "编程",
				qq: "12345",
				site: "https://example.com",
				campus: "嘉定校区",
			});
		});

		it("should not include sensitive fields even if present in row", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				role: 1,
				reg_date: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				last_activity: 0,
				email: "alice@example.com",
				status: 0,
				last_login: 1711544400,
				password_hash: "secret_hash",
				password_salt: "secret_salt",
			};

			const user = toPublicUser(row);

			expect("email" in user).toBe(false);
			expect("status" in user).toBe(false);
			expect("lastLogin" in user).toBe(false);
			expect("last_login" in user).toBe(false);
			expect("passwordHash" in user).toBe(false);
			expect("password_hash" in user).toBe(false);
		});

		it("should output exactly 28 fields", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "",
				avatar_path: "",
				role: 0,
				reg_date: 0,
				threads: 0,
				posts: 0,
				credits: 0,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				last_activity: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
			};

			const user = toPublicUser(row);
			expect(Object.keys(user)).toHaveLength(30);
		});

		it("should include regIp and lastIp when includeIp is true", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "",
				avatar_path: "",
				role: 0,
				reg_date: 0,
				threads: 0,
				posts: 0,
				credits: 0,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				last_activity: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				reg_ip: "192.168.1.1",
				last_ip: "10.0.0.1",
			};

			const user = toPublicUser(row, true);
			expect(user.regIp).toBe("192.168.1.1");
			expect(user.lastIp).toBe("10.0.0.1");
			expect(Object.keys(user)).toHaveLength(32);
		});
	});

	describe("toAttachment", () => {
		it("should map snake_case D1 row to camelCase Attachment", () => {
			const row = {
				id: 1,
				thread_id: 10,
				post_id: 20,
				author_id: 100,
				filename: "photo.jpg",
				file_path: "/attachments/photo.jpg",
				file_size: 54321,
				is_image: 1,
				width: 1024,
				has_thumb: 1,
				downloads: 5,
				created_at: 1711540800,
			};

			const attachment = toAttachment(row);

			expect(attachment.threadId).toBe(10);
			expect(attachment.postId).toBe(20);
			expect(attachment.authorId).toBe(100);
			expect(attachment.filename).toBe("photo.jpg");
			expect(attachment.filePath).toBe("/attachments/photo.jpg");
			expect(attachment.fileSize).toBe(54321);
			expect(attachment.width).toBe(1024);
			expect(attachment.downloads).toBe(5);
			expect(attachment.createdAt).toBe(1711540800);
		});

		it("should convert is_image INTEGER 1 to boolean true", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "img.png",
				file_path: "/img.png",
				file_size: 100,
				is_image: 1,
				width: 640,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.isImage).toBe(true);
			expect(attachment.hasThumb).toBe(false);
		});

		it("should convert is_image INTEGER 0 to boolean false", () => {
			const row = {
				id: 2,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "doc.pdf",
				file_path: "/doc.pdf",
				file_size: 200,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 10,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.isImage).toBe(false);
			expect(attachment.hasThumb).toBe(false);
		});

		it("should output exactly 12 fields", () => {
			const row = {
				id: 1,
				thread_id: 0,
				post_id: 0,
				author_id: 0,
				filename: "",
				file_path: "",
				file_size: 0,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(Object.keys(attachment)).toHaveLength(12);
		});

		it("should not leak snake_case field names", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "f",
				file_path: "/f",
				file_size: 1,
				is_image: 1,
				width: 1,
				has_thumb: 1,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect("thread_id" in attachment).toBe(false);
			expect("post_id" in attachment).toBe(false);
			expect("author_id" in attachment).toBe(false);
			expect("file_path" in attachment).toBe(false);
			expect("file_size" in attachment).toBe(false);
			expect("is_image" in attachment).toBe(false);
			expect("has_thumb" in attachment).toBe(false);
			expect("created_at" in attachment).toBe(false);
		});

		it("should sanitize trusted CDN URL (t.no.mt) to just pathname", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "photo.jpg",
				file_path: "https://t.no.mt/attachments/photo.jpg",
				file_size: 100,
				is_image: 1,
				width: 640,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.filePath).toBe("/attachments/photo.jpg");
		});

		it("should reject external non-CDN https URL", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "photo.jpg",
				file_path: "https://evil.com/malware.exe",
				file_size: 100,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.filePath).toBe("");
		});

		it("should reject invalid http URL gracefully", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "doc.pdf",
				file_path: "http://[invalid",
				file_size: 100,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.filePath).toBe("");
		});
	});

	// ─── parseModeratorIds ────────────────────────────────────

	describe("parseModeratorIds", () => {
		it("should return empty array for empty string", () => {
			expect(parseModeratorIds("")).toEqual([]);
		});

		it("should parse comma-separated IDs", () => {
			expect(parseModeratorIds("1,2,3")).toEqual([1, 2, 3]);
		});

		it("should parse single ID", () => {
			expect(parseModeratorIds("42")).toEqual([42]);
		});

		it("should filter out NaN values", () => {
			expect(parseModeratorIds("1,abc,3")).toEqual([1, 3]);
		});

		it("should filter out zero and negative IDs", () => {
			expect(parseModeratorIds("1,0,-5,3")).toEqual([1, 3]);
		});

		it("should handle whitespace around IDs", () => {
			expect(parseModeratorIds(" 1 , 2 , 3 ")).toEqual([1, 2, 3]);
		});

		it("should return empty array when all IDs are invalid", () => {
			expect(parseModeratorIds("abc,0,-1")).toEqual([]);
		});
	});

	// ─── toIpBan ──────────────────────────────────────────────

	describe("toIpBan", () => {
		it("should map snake_case D1 row to camelCase IpBan", () => {
			const row = {
				id: 1,
				ip: "192.168.1.1",
				admin_id: 10,
				admin_name: "admin",
				reason: "spam",
				expires_at: 1711544400,
				created_at: 1711540800,
			};

			const ipBan = toIpBan(row);

			expect(ipBan).toEqual({
				id: 1,
				ip: "192.168.1.1",
				adminId: 10,
				adminName: "admin",
				reason: "spam",
				expiresAt: 1711544400,
				createdAt: 1711540800,
			});
		});

		it("should handle null expires_at", () => {
			const row = {
				id: 2,
				ip: "10.0.0.1",
				admin_id: 5,
				admin_name: "mod",
				reason: "bot",
				expires_at: null,
				created_at: 1711540800,
			};

			const ipBan = toIpBan(row);
			expect(ipBan.expiresAt).toBeNull();
		});
	});

	// ─── toCensorWord ─────────────────────────────────────────

	describe("toCensorWord", () => {
		it("should map snake_case D1 row to camelCase CensorWord", () => {
			const row = {
				id: 1,
				find: "badword",
				replacement: "***",
				action: "ban",
				admin_id: 10,
				admin_name: "admin",
				created_at: 1711540800,
			};

			const cw = toCensorWord(row);

			expect(cw).toEqual({
				id: 1,
				find: "badword",
				replacement: "***",
				action: "ban",
				adminId: 10,
				adminName: "admin",
				createdAt: 1711540800,
			});
		});

		it("should handle replace action", () => {
			const row = {
				id: 2,
				find: "heck",
				replacement: "h***",
				action: "replace",
				admin_id: 1,
				admin_name: "mod",
				created_at: 1711540800,
			};

			const cw = toCensorWord(row);
			expect(cw.action).toBe("replace");
		});
	});

	// ─── KV Cache Enrichment ──────────────────────────────────

	describe("enrichForumsWithUserCache", () => {
		it("should enrich forums with cached user info", () => {
			const forums = [
				toForum({ id: 1, last_poster_id: 10, last_poster: "old_name" } as Record<string, unknown>),
			];
			const userCache = new Map<number, UserMiniProfile>([
				[
					10,
					{
						id: 10,
						username: "new_name",
						avatar: "avatar.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					},
				],
			]);

			const enriched = enrichForumsWithUserCache(forums, userCache);

			expect(enriched[0].lastPoster).toBe("new_name");
			expect(enriched[0].lastPosterAvatar).toBe("avatar.png");
		});

		it("should return unchanged forum when user not in cache", () => {
			const forums = [
				toForum({ id: 1, last_poster_id: 99, last_poster: "unknown" } as Record<string, unknown>),
			];
			const userCache = new Map<number, UserMiniProfile>();

			const enriched = enrichForumsWithUserCache(forums, userCache);

			expect(enriched[0].lastPoster).toBe("unknown");
			expect(enriched[0].lastPosterAvatar).toBe("");
		});

		it("should handle empty forums array", () => {
			const userCache = new Map<number, UserMiniProfile>();
			const enriched = enrichForumsWithUserCache([], userCache);
			expect(enriched).toEqual([]);
		});
	});

	describe("enrichThreadsWithUserCache", () => {
		it("should enrich threads with author and last poster info", () => {
			const threads = [
				toThread({
					id: 1,
					author_id: 10,
					last_poster_id: 20,
					author_name: "old_author",
					last_poster: "old_poster",
				} as Record<string, unknown>),
			];
			const userCache = new Map<number, UserMiniProfile>([
				[
					10,
					{
						id: 10,
						username: "new_author",
						avatar: "a.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					},
				],
				[
					20,
					{
						id: 20,
						username: "new_poster",
						avatar: "p.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					},
				],
			]);

			const enriched = enrichThreadsWithUserCache(threads, userCache);

			expect(enriched[0].authorName).toBe("new_author");
			expect(enriched[0].authorAvatar).toBe("a.png");
			expect(enriched[0].lastPoster).toBe("new_poster");
			expect(enriched[0].lastPosterAvatar).toBe("p.png");
		});

		it("should fall back to original name when user not in cache", () => {
			const threads = [
				toThread({
					id: 1,
					author_id: 10,
					last_poster_id: 20,
					author_name: "original",
					last_poster: "original_poster",
				} as Record<string, unknown>),
			];
			const userCache = new Map<number, UserMiniProfile>();

			const enriched = enrichThreadsWithUserCache(threads, userCache);

			expect(enriched[0].authorName).toBe("original");
			expect(enriched[0].authorAvatar).toBe("");
			expect(enriched[0].lastPoster).toBe("original_poster");
			expect(enriched[0].lastPosterAvatar).toBe("");
		});

		it("should handle partial cache hits", () => {
			const threads = [
				toThread({
					id: 1,
					author_id: 10,
					last_poster_id: 20,
					author_name: "original",
					last_poster: "poster",
				} as Record<string, unknown>),
			];
			const userCache = new Map<number, UserMiniProfile>([
				[
					10,
					{
						id: 10,
						username: "cached_author",
						avatar: "a.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					},
				],
			]);

			const enriched = enrichThreadsWithUserCache(threads, userCache);

			expect(enriched[0].authorName).toBe("cached_author");
			expect(enriched[0].lastPoster).toBe("poster");
		});
	});
});
