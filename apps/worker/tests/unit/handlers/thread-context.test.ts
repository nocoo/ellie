import { encodeGenericCursor } from "@ellie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadContext } from "../../../src/handlers/thread-context";
import { createJwt } from "../../../src/lib/jwt";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

const body = {
	threadId: 1,
	limit: 20,
	cursor: null as string | null,
	last: false,
	cachedRevision: null as string | null,
	includeDisplay: true,
	includeStats: false,
};

function post(
	payload: unknown,
	headers?: Record<string, string>,
	path = "/api/v1/threads/context",
) {
	return new Request(`https://api.example.com${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(payload),
	});
}

describe("POST /api/v1/threads/context", () => {
	let f: ReturnType<typeof readingFixture>;

	afterEach(() => {
		f?.close();
	});

	function open() {
		f = readingFixture();
		f.thread(1);
		f.post(1, { position: 1, is_first: 1 });
		return f;
	}

	async function token(userId: number, role: number) {
		return createJwt({ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 }, f.env.JWT_SECRET);
	}

	it("returns a fresh thread and no-store display without KV or writes", async () => {
		open();
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const payload = await response.json();
		expect(payload.data.thread.id).toBe(1);
		expect(payload.data.user).toBeNull();
		expect(payload.data.cacheable).toBe(true);
		expect(payload.data.display.posts).toHaveLength(1);
		expect(payload.data.display.forum.id).toBe(1);
		expect(payload.data.nextCursor).toBeNull();
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls.some((call) => call.mode === "run")).toBe(false);
	});

	it("skips bodies, ratings, attachments and profiles on a public warm hit", async () => {
		open();
		const cold = await threadContext(post(body), f.env);
		const revision = (await cold.json()).data.revision as string;
		f.calls.length = 0;
		const warm = await threadContext(
			post({ ...body, includeDisplay: false, cachedRevision: revision }),
			f.env,
		);
		const payload = await warm.json();
		expect(payload.data.display).toBeUndefined();
		expect(payload.data.thread.subject).toBe("Thread 1");
		const sql = f.calls.map((call) => call.sql).join("\n");
		expect(sql).not.toContain("content");
		expect(sql).not.toContain("attachments");
		expect(sql).not.toContain("post_ratings");
		expect(sql).not.toContain("signature");
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it("keeps the latest 20 of 25 posts and does not invent a next cursor", async () => {
		open();
		for (let id = 2; id <= 25; id++)
			f.post(id, { position: id, author_id: 20, author_name: "bob" });
		const response = await threadContext(post({ ...body, last: true }), f.env);
		const payload = await response.json();
		expect(payload.data.display.posts.map((post: { position: number }) => post.position)).toEqual(
			Array.from({ length: 20 }, (_, index) => index + 6),
		);
		expect(payload.data.nextCursor).toBeNull();
	});

	it("derives the forward cursor from the last returned post", async () => {
		open();
		for (let id = 2; id <= 25; id++) f.post(id, { position: id });
		const response = await threadContext(post(body), f.env);
		const payload = await response.json();
		expect(payload.data.display.posts).toHaveLength(20);
		expect(payload.data.nextCursor).toBe(encodeGenericCursor({ position: 20 }));
	});

	it("masks anonymous attachment ownership for a common reader and reveals it to the author", async () => {
		open();
		f.post(2, { position: 2, anonymous: 1, author_id: 10, author_name: "alice" });
		f.insert("attachments", {
			id: 1,
			thread_id: 1,
			post_id: 2,
			author_id: 10,
			filename: "photo.jpg",
			file_path: "202003/15/photo.jpg",
		});
		const anon = await (await threadContext(post(body), f.env)).json();
		const masked = anon.data.display.attachments[0];
		expect(masked.authorId).toBe(0);
		expect(masked.filePath).toBe("202003/15/photo.jpg");
		expect(anon.data.display.posts.find((post: { id: number }) => post.id === 2).authorId).toBe(0);
		expect(anon.data.cacheable).toBe(true);
		const owner = await (
			await threadContext(post(body, { Authorization: `Bearer ${await token(10, 0)}` }), f.env)
		).json();
		expect(owner.data.cacheable).toBe(false);
		expect(owner.data.display.posts.find((post: { id: number }) => post.id === 2).authorId).toBe(
			10,
		);
		expect(owner.data.display.attachments[0].authorId).toBe(10);
	});

	it("always returns a full display for staff even when the public revision matches", async () => {
		open();
		const cold = await (await threadContext(post(body), f.env)).json();
		const response = await threadContext(
			post(
				{ ...body, includeDisplay: false, cachedRevision: cold.data.revision },
				{ Authorization: `Bearer ${await token(1, 1)}` },
			),
			f.env,
		);
		const payload = await response.json();
		expect(payload.data.cacheable).toBe(false);
		expect(payload.data.display.posts).toHaveLength(1);
		expect(payload.data.user.id).toBe(1);
	});

	it("returns forum null when an ancestor is hidden and still returns the thread", async () => {
		open();
		f.insert("forums", { id: 4, name: "Members", visibility: "members", status: 1 });
		f.insert("forums", {
			id: 5,
			name: "Child",
			parent_id: 4,
			visibility: "public",
			status: 1,
		});
		f.sqlite.prepare("UPDATE threads SET forum_id = 5 WHERE id = 1").run();
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.data.thread.id).toBe(1);
		expect(payload.data.display.forum).toBeNull();
		expect(payload.data.display.ancestors).toEqual([]);
		expect(payload.data.cacheable).toBe(true);
	});

	it("shares one public revision and still returns a private display to the author and staff", async () => {
		open();
		f.post(2, { position: 2, anonymous: 1, author_id: 10, author_name: "alice" });
		const cold = await (await threadContext(post(body), f.env)).json();
		const anon = await (
			await threadContext(
				post({ ...body, includeDisplay: false, cachedRevision: cold.data.revision }),
				f.env,
			)
		).json();
		const owner = await (
			await threadContext(
				post(
					{ ...body, includeDisplay: false, cachedRevision: cold.data.revision },
					{ Authorization: `Bearer ${await token(10, 0)}` },
				),
				f.env,
			)
		).json();
		const staff = await (
			await threadContext(
				post(
					{ ...body, includeDisplay: false, cachedRevision: cold.data.revision },
					{ Authorization: `Bearer ${await token(30, 3)}` },
				),
				f.env,
			)
		).json();
		expect(owner.data.revision).toBe(anon.data.revision);
		expect(staff.data.revision).toBe(anon.data.revision);
		expect(anon.data.cacheable).toBe(true);
		expect(anon.data.display).toBeUndefined();
		expect(owner.data.cacheable).toBe(false);
		expect(owner.data.display.posts.find((item: { id: number }) => item.id === 2).authorId).toBe(
			10,
		);
		expect(staff.data.cacheable).toBe(false);
		expect(staff.data.display.posts.find((item: { id: number }) => item.id === 2).authorId).toBe(
			10,
		);
		expect(staff.data.display.authors[0].regIp).toBeUndefined();
		expect(staff.data.display.authors[0].lastIp).toBeUndefined();
	});

	it("changes revision when an author is banned without a notification", async () => {
		open();
		const before = await (await threadContext(post(body), f.env)).json();
		f.sqlite.prepare("UPDATE users SET status = -1 WHERE id = 10").run();
		const after = await (
			await threadContext(
				post({ ...body, includeDisplay: false, cachedRevision: before.data.revision }),
				f.env,
			)
		).json();
		expect(after.data.revision).not.toBe(before.data.revision);
		expect(after.data.display.authors.map((author: { id: number }) => author.id)).not.toContain(10);
		expect(after.data.display.posts[0].authorName).toBe("alice");
	});

	it("hides a pending thread from strangers and returns a private display to its author", async () => {
		open();
		f.sqlite.prepare("UPDATE threads SET sticky = -2 WHERE id = 1").run();
		expect((await threadContext(post(body), f.env)).status).toBe(404);
		const author = await (
			await threadContext(
				post({ ...body, includeDisplay: false }, { Authorization: `Bearer ${await token(10, 0)}` }),
				f.env,
			)
		).json();
		expect(author.data.cacheable).toBe(false);
		expect(author.data.thread.moderationStatus).toBe("pending_review");
		expect(author.data.display.posts).toHaveLength(1);
	});

	it("loads 100 authors in batches of 80", async () => {
		open();
		for (let id = 100; id < 199; id++) {
			f.insert("users", { id, username: `user${id}`, role: 0, email_verified_at: 1 });
			f.post(id, { position: id, author_id: id, author_name: `user${id}`, is_first: 0 });
		}
		f.calls.length = 0;
		const response = await threadContext(post({ ...body, limit: 100 }), f.env);
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.data.display.authors).toHaveLength(100);
		const profileQueries = f.calls.filter((call) => call.sql.includes("signature"));
		expect(profileQueries).toHaveLength(2);
		expect(profileQueries.every((call) => call.params.length <= 80)).toBe(true);
		expect(f.calls.filter((call) => call.sql.includes("reg_ip"))).toHaveLength(0);
	});

	it("changes revision when a global announcement moves between hidden sources", async () => {
		open();
		f.insert("forums", { id: 8, name: "Other staff", visibility: "staff", status: 1 });
		f.sqlite.prepare("UPDATE threads SET forum_id = 2, sticky = 2 WHERE id = 1").run();
		const before = await (await threadContext(post(body), f.env)).json();
		expect(before.data.display.forum).toBeNull();
		expect(before.data.display.posts[0].forumId).toBe(2);
		f.sqlite.prepare("UPDATE threads SET forum_id = 8 WHERE id = 1").run();
		const after = await (
			await threadContext(
				post({ ...body, includeDisplay: false, cachedRevision: before.data.revision }),
				f.env,
			)
		).json();
		expect(after.data.revision).not.toBe(before.data.revision);
		expect(after.data.display.forum).toBeNull();
		expect(after.data.display.posts[0].forumId).toBe(8);
		expect(after.data.thread.forumId).toBe(8);
	});

	it("includes forum type in the revision", async () => {
		open();
		const before = await (await threadContext(post(body), f.env)).json();
		expect(before.data.display.forum.type).toBe("forum");
		f.sqlite.prepare("UPDATE forums SET type = 'sub' WHERE id = 1").run();
		const after = await (
			await threadContext(
				post({ ...body, includeDisplay: false, cachedRevision: before.data.revision }),
				f.env,
			)
		).json();
		expect(after.data.revision).not.toBe(before.data.revision);
		expect(after.data.display.forum.type).toBe("sub");
	});

	it("rejects a self-parent forum and a chain longer than the read bound", async () => {
		open();
		f.sqlite.prepare("UPDATE forums SET parent_id = 1 WHERE id = 1").run();
		expect((await threadContext(post(body), f.env)).status).toBe(503);
		f.close();
		open();
		for (let id = 100; id <= 132; id++) {
			f.insert("forums", {
				id,
				name: `F${id}`,
				parent_id: id === 100 ? 0 : id - 1,
				visibility: "public",
				status: 1,
			});
		}
		f.sqlite.prepare("UPDATE threads SET forum_id = 132 WHERE id = 1").run();
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(503);
		expect(f.calls.some((call) => call.sql.includes("LIMIT 33"))).toBe(true);
	});

	it("does not return a partial display when a current post body is missing", async () => {
		open();
		f.state.afterRead = async (sql) => {
			if (!sql.includes("invisible, anonymous, author_id")) return;
			f.sqlite.prepare("DELETE FROM posts WHERE id = 1").run();
			f.state.afterRead = undefined;
		};
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toContain("no-store");
	});

	it("rejects a query string and a bad token", async () => {
		open();
		const queried = await threadContext(
			post(body, undefined, "/api/v1/threads/context?page=2"),
			f.env,
		);
		expect(queried.status).toBe(400);
		const denied = await threadContext(post(body, { Authorization: "Bearer nope" }), f.env);
		expect(denied.status).toBe(401);
	});

	it("renders a display larger than 2 MiB", async () => {
		open();
		const length = 2 * 1024 * 1024 + 1;
		f.sqlite.prepare("UPDATE posts SET content = ? WHERE id = 1").run("x".repeat(length));
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.data.display.posts[0].content.length).toBe(length);
	});

	it("never shares a member-only source beneath an ancestor hidden from that member", async () => {
		open();
		f.insert("forums", { id: 4, name: "Members", visibility: "members", parent_id: 2 });
		f.sqlite.prepare("UPDATE threads SET forum_id = 4 WHERE id = 1").run();
		const headers = { Authorization: `Bearer ${await token(10, 0)}` };
		const first = await threadContext(post(body, headers), f.env);
		expect(first.status).toBe(200);
		const cold = await first.json();
		expect(cold.data.cacheable).toBe(false);
		expect(cold.data.display.forum).toBeNull();
		const warm = await threadContext(
			post({ ...body, cachedRevision: cold.data.revision, includeDisplay: false }, headers),
			f.env,
		);
		const result = await warm.json();
		expect(result.data.cacheable).toBe(false);
		expect(result.data.display.posts).toHaveLength(1);
		expect((await threadContext(post(body), f.env)).status).toBe(403);
	});

	it.each([false, true])(
		"refuses a second membership race with later eligible posts (%s)",
		async (last) => {
			open();
			for (let id = 2; id <= 50; id++) f.post(id);
			let selections = 0;
			f.state.afterRead = async (sql) => {
				if (!sql.includes("ORDER BY position")) return;
				selections++;
				const id = last ? 51 - selections : selections;
				f.sqlite.prepare("UPDATE posts SET invisible = 1 WHERE id = ?").run(id);
			};
			const response = await threadContext(post({ ...body, last }), f.env);
			expect(response.status).toBe(503);
			expect(response.headers.get("cache-control")).toContain("no-store");
			expect(selections).toBe(2);
		},
	);

	it("recovers once after a membership race and retains the correct next cursor", async () => {
		open();
		for (let id = 2; id <= 30; id++) f.post(id);
		f.state.afterRead = async (sql) => {
			if (!sql.includes("ORDER BY position")) return;
			f.sqlite.prepare("UPDATE posts SET invisible = 1 WHERE id = 1").run();
			f.state.afterRead = undefined;
		};
		const response = await threadContext(post(body), f.env);
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.data.display.posts).toHaveLength(20);
		expect(result.data.display.posts[0].id).toBe(2);
		expect(result.data.nextCursor).toBe(encodeGenericCursor({ position: 21 }));
	});

	it.each(["Basic token", "Bearer "])(
		"rejects malformed authorization %s",
		async (authorization) => {
			open();
			const response = await threadContext(post(body, { Authorization: authorization }), f.env);
			expect(response.status).toBe(401);
			expect(response.headers.get("cache-control")).toContain("no-store");
		},
	);

	it.each([
		{ userId: 10, role: 0, exp: 1 },
		{ userId: -1, role: 0, exp: 4_000_000_000 },
	])("rejects expired or invalid signed claims %j", async (claims) => {
		open();
		const jwt = await createJwt(claims, f.env.JWT_SECRET);
		expect(
			(await threadContext(post(body, { Authorization: `Bearer ${jwt}` }), f.env)).status,
		).toBe(401);
	});

	it.each([
		{ value: "{}", headers: { "content-type": "text/plain" } },
		{ value: "x".repeat(4097), headers: {} },
		{ value: "{}", headers: { "content-length": "4097" } },
		{ value: "{}", headers: { "content-length": "invalid" } },
		{ value: "{", headers: {} },
		{ value: null, headers: {} },
		{ value: "{}", headers: {} },
	])("rejects malformed transport input %j", async ({ value, headers }) => {
		open();
		const request = new Request("https://api.example.com/api/v1/threads/context", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: value,
		});
		expect((await threadContext(request, f.env)).status).toBe(400);
		expect(f.calls).toHaveLength(0);
	});

	it("uses empty daily estimates without querying statistics tables", async () => {
		open();
		const good = await (await threadContext(post({ ...body, includeStats: true }), f.env)).json();
		expect(good.data.stats).toHaveProperty("totalOnline");
		const original = f.env.DB.prepare.bind(f.env.DB);
		const prepare = vi.spyOn(f.env.DB, "prepare").mockImplementation((sql) => {
			if (sql.includes("SELECT key, value FROM settings")) throw new Error("Unavailable");
			return original(sql);
		});
		try {
			const response = await threadContext(post({ ...body, includeStats: true }), f.env);
			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.data.stats.totalThreads).toBe(0);
			expect(result.data.display.posts).toHaveLength(1);
		} finally {
			prepare.mockRestore();
		}
	});

	it("propagates a failed authority query without returning cacheable data", async () => {
		open();
		f.state.queryError = true;
		await expect(threadContext(post(body), f.env)).rejects.toThrow("could not be loaded");
	});
});
