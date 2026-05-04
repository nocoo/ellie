// tests/e2e/admin/admin-threads.spec.ts — A2 admin threads/posts L3 smoke
//
// End-to-end smoke for /admin/threads and /admin/threads/[id] covering the
// minimum closed loop the reviewer chose (option B):
//   1. Navigate from list → detail via the seed thread 662174.
//   2. Edit thread subject (mutate + assert + restore in afterEach).
//   3. Edit a non-first post on page 1 (post 700001 / position #2).
//   4. Open the first post's action menu and assert the delete item is
//      present, disabled, and labeled "无法删除楼主帖" — proves the UI
//      safety guard against the worker's CANNOT_DELETE_FIRST_POST 400.
//
// Why no destructive delete: the admin app has no POST create endpoint
// for threads/posts, so a deleted seed row could only be restored by
// re-running scripts/seed-test-db.sql. We don't want L3 specs to leave
// the DB in a state that requires external reseed; mutations are
// restored in afterEach via PATCH instead.
//
// Selector strategy:
//   - /admin/threads is a real <table> (AdminDataTable), so the row link
//     is reachable via getByRole("link", { name: <subject> }).
//   - PostFloor's MoreHorizontal trigger now has aria-label
//     `打开第 {position} 楼操作菜单` (added by this batch) so per-post
//     menu opens are addressable by accessible name.
//   - Detail page top-right 编辑/删除 are plain text buttons — getByRole
//     with name is sufficient. Scope dialog interactions inside
//     getByRole("dialog", { name: "编辑主题" | "编辑帖子" }) so they
//     don't collide with the page-level buttons of the same text.
//
// Cleanup:
//   - afterEach captures the original subject + content snapshots and
//     PATCHes them back via the admin proxy with explicit Origin to
//     pass the CSRF gate. Restore failures only log; they don't shadow
//     the test body's primary assertion failure.

import { expect, test } from "./fixtures/admin-base";

const SEED_THREAD_ID = 662174;
// Post 700001 is position #2 in thread 662174 — the first reply, always
// visible on detail page 1 (default limit=20). Subject and content are
// fetched live in the test rather than hard-coded so afterEach restores
// whatever was actually present at start.
const SEED_REPLY_POST_ID = 700001;

interface ThreadResponse {
	data: { id: number; subject: string };
}

interface PostResponse {
	data: { id: number; content: string };
}

test.describe("Admin threads/posts CRUD", () => {
	// Snapshots captured before mutation so afterEach can restore even if
	// the test body asserts before reaching the restore lines itself.
	let originalSubject: string | null = null;
	let originalPostContent: string | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		const origin = baseURL ?? "http://localhost:7032";

		if (originalSubject !== null) {
			const snap = originalSubject;
			originalSubject = null;
			try {
				const res = await context.request.patch(`/api/admin/threads/${SEED_THREAD_ID}`, {
					headers: { Origin: origin, "Content-Type": "application/json" },
					data: { subject: snap },
				});
				if (!res.ok()) {
					console.warn(`afterEach thread restore got status ${res.status()}`);
				}
			} catch (err) {
				console.warn("afterEach thread restore threw:", err);
			}
		}

		if (originalPostContent !== null) {
			const snap = originalPostContent;
			originalPostContent = null;
			try {
				const res = await context.request.patch(`/api/admin/posts/${SEED_REPLY_POST_ID}`, {
					headers: { Origin: origin, "Content-Type": "application/json" },
					data: { content: snap },
				});
				if (!res.ok()) {
					console.warn(`afterEach post restore got status ${res.status()}`);
				}
			} catch (err) {
				console.warn("afterEach post restore threw:", err);
			}
		}
	});

	test("list → detail → edit thread / edit post / first-post delete guard", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		const origin = baseURL ?? "http://localhost:7032";

		// Mint the admin session cookie BEFORE any context.request calls —
		// the admin proxy's GET handlers also pass through auth() +
		// resolveAdmin(), so without the session cookie even snapshot reads
		// would 401. context.request shares cookies with the browser
		// context, so once loginAsAdmin() injects the cookie, both UI
		// navigations and direct admin proxy calls are authenticated.
		await loginAsAdmin();

		// Snapshot real current values via API up-front so afterEach can
		// restore exactly what we found, regardless of UI display formatting.
		{
			const res = await context.request.get(`/api/admin/threads/${SEED_THREAD_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok(), "GET /api/admin/threads/:id should succeed").toBeTruthy();
			originalSubject = ((await res.json()) as ThreadResponse).data.subject;
		}
		expect(
			typeof originalSubject === "string" && originalSubject.length > 0,
			"originalSubject snapshot must be a non-empty string",
		).toBeTruthy();
		{
			const res = await context.request.get(`/api/admin/posts/${SEED_REPLY_POST_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok(), "GET /api/admin/posts/:id should succeed").toBeTruthy();
			originalPostContent = ((await res.json()) as PostResponse).data.content;
		}
		expect(
			typeof originalPostContent === "string" && originalPostContent.length > 0,
			"originalPostContent snapshot must be a non-empty string",
		).toBeTruthy();

		// ── LIST → DETAIL ──────────────────────────────────────────────
		await page.goto("/admin/threads");
		await expect(page.getByRole("heading", { name: "主题" })).toBeVisible();

		// Click the subject Link in the table row to navigate to detail.
		// The link's accessible name is the subject (which may already
		// contain a previous test's suffix if afterEach ran). Use the
		// snapshot we just fetched for the most current value.
		await page.getByRole("link", { name: originalSubject }).click();
		await expect(page).toHaveURL(new RegExp(`/admin/threads/${SEED_THREAD_ID}(\\?|$)`));

		// h1 shows the current subject.
		await expect(page.getByRole("heading", { name: originalSubject })).toBeVisible();

		// ── EDIT THREAD SUBJECT ────────────────────────────────────────
		const subjectSuffix = `_e2e_${Date.now()}`;
		const newSubject = `${originalSubject}${subjectSuffix}`;

		await page.getByRole("button", { name: "编辑" }).click();
		const threadDialog = page.getByRole("dialog", { name: "编辑主题" });
		await expect(threadDialog).toBeVisible();
		await threadDialog.getByLabel("标题").fill(newSubject);
		await threadDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(threadDialog).toBeHidden();
		await expect(page.getByRole("heading", { name: newSubject })).toBeVisible();

		// ── EDIT NON-FIRST POST (#2 / post 700001) ─────────────────────
		const contentSuffix = `\n\n[edited by L3 ${Date.now()}]`;
		const newContent = `${originalPostContent}${contentSuffix}`;

		await page.getByRole("button", { name: "打开第 2 楼操作菜单" }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();
		const postDialog = page.getByRole("dialog", { name: "编辑帖子" });
		await expect(postDialog).toBeVisible();
		await postDialog.getByLabel("内容").fill(newContent);
		await postDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(postDialog).toBeHidden();
		// Asserting on a unique substring keeps the assertion robust to any
		// surrounding markup — the content is rendered with whitespace-pre-wrap.
		await expect(page.getByText(`[edited by L3`, { exact: false })).toBeVisible();

		// ── FIRST-POST DELETE GUARD (#1) ───────────────────────────────
		// Open the first post's menu; the 删除 item must be disabled and
		// labeled "无法删除楼主帖" (PostFloor enforces this so the worker
		// never sees a CANNOT_DELETE_FIRST_POST request from the UI).
		await page.getByRole("button", { name: "打开第 1 楼操作菜单" }).click();
		const guardItem = page.getByRole("menuitem", { name: "无法删除楼主帖" });
		await expect(guardItem).toBeVisible();
		await expect(guardItem).toBeDisabled();
	});
});
