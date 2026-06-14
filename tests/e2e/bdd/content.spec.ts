// tests/e2e/bdd/content.spec.ts — Feature: Forum Content (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 3.1), §4.3 (stateful protection),
//      §5.3 (合并表)
//
// Merges 7 legacy specs (thread + thread-crud + post + post-crud +
// post-comments + pagination + digest-filter, 12 tests) into
// tests/e2e/bdd/content.spec.ts (10 BDD scenarios). Read-only scenarios run
// without .serial; CRUD scenarios sit inside dedicated .serial blocks so
// the stateful project's create → view (Thread) and reply → edit → delete
// (Post) ordering is preserved. Traceability map lives in the commit body.

import { ForumPage } from "../pages/forum.page";
import { ThreadPage } from "../pages/thread.page";
import { expect, test } from "./fixtures";

const POPULATED_THREAD_ID = 662174;
const FORUM_WITH_NEW_THREAD = 1;
const POPULATED_FORUM_ID = 114;
const THREAD_FOR_POST_CRUD = 1;

test.describe("Feature: Forum Content", () => {
	// -------------------------------------------------------------------------
	// Read-only scenarios — safe under stateful's fullyParallel=false, no
	// describe.serial wrapper needed.
	// -------------------------------------------------------------------------

	test("Given I am logged in, When I open a populated thread, Then I see the subject heading, author info, and post cards with prose content", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: open the populated thread
		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);

		// Then: subject heading
		await expect(threadPage.heading).toBeVisible();
		const subject = await threadPage.heading.textContent();
		expect(subject).toBeTruthy();

		// Then: author info link in the sidebar
		await expect(threadPage.authorInfo).toBeVisible();

		// Then: ≥1 post card with prose content. Merges PO-01 here because
		// both TH-01 (subject + author + first post visible) and PO-01 (post
		// cards visible with author link + prose) land on the same thread and
		// assert against the same first post card — splitting them would just
		// re-pay the goto + post-load wait.
		const firstPost = threadPage.postCards.first();
		await expect(firstPost).toBeVisible();

		const authorLink = firstPost.locator('a[href^="/users/"]');
		await expect(authorLink.first()).toBeVisible();

		const postContent = firstPost.locator(".prose").first();
		await expect(postContent).toBeVisible();
	});

	test("Given I am on a thread with seeded comments, Then a 点评 section renders the comment text and a 点评 action button surfaces in the post action bar", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated thread
		await loginAs("e2etest");
		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);

		// Then: posts have loaded
		await expect(threadPage.postCards.first()).toBeVisible();

		// Then: seeded comment content from PC-01 ("写得好！" by e2etest /
		// e2eprofile on post 662174) is visible inside the 点评 section.
		await expect(page.getByText("写得好！").first()).toBeVisible({ timeout: 10_000 });

		// Then: comment author link to /users/100 exists. Merges PC-01 + PC-02
		// because both load the same thread, both assert against the same
		// rendered comment region, and the action-bar 点评 button is the
		// natural sibling assertion to "comment text rendered" — kept as one
		// scenario per docs/23 §4.3 stateful protection guidance.
		const commentAuthorLink = page.locator('a[href="/users/100"]');
		expect(await commentAuthorLink.count()).toBeGreaterThan(0);

		// Then: ≥1 点评 action surface on a post action bar (PC-02). The
		// 点评 string also appears inside the comment header, so we count
		// both buttons and spans to match the legacy assertion shape.
		const commentButtons = page.locator('button:has-text("点评"), span:has-text("点评")');
		expect(await commentButtons.count()).toBeGreaterThan(0);
	});

	test("Given I am on a populated forum, Then the forum page exposes pagination controls (page links or load-more)", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);

		// Then: thread list rendered
		await expect(forumPage.threadItems.first()).toBeVisible();

		// Then: at least one pagination mechanism exists. Forum 114 uses
		// path-segment pagination /forums/114/2; we accept either page-link or
		// load-more button so the assertion doesn't tie to one UI choice.
		const pageLinks = page.locator(`a[href*="/forums/${POPULATED_FORUM_ID}/"]`);
		const loadMore = page.locator('button:has-text("加载更多"), button:has-text("下一页")');

		const hasPageLinks = (await pageLinks.count()) > 0;
		const hasLoadMore = await loadMore.isVisible().catch(() => false);
		expect(hasPageLinks || hasLoadMore).toBe(true);
	});

	test("Given I am on a populated thread, When I click the page-2 link, Then the URL updates to the /threads/<id>/2 path and post cards still render", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated thread (≥20 posts → 2 pages)
		await loginAs("e2etest");
		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);

		// Then: page-1 has posts
		await expect(threadPage.postCards.first()).toBeVisible();

		// When: click the page-2 link
		// CSS fallback: thread pagination uses path-segment URLs (no ?page=);
		// the rendered anchor has no accessible name, so href-suffix is the
		// only stable hook.
		const page2Link = page.locator(`a[href$="/threads/${POPULATED_THREAD_ID}/2"]`);
		await expect(page2Link.first()).toBeVisible({ timeout: 5_000 });
		await page2Link.first().click();
		await page.waitForURL(new RegExp(`/threads/${POPULATED_THREAD_ID}/2`));

		// Then: post cards rendered on page 2
		await expect(threadPage.postCards.first()).toBeVisible();
	});

	test("Given I am on /digest, When I click a level filter tab, Then the URL gains ?level= and the page still renders the 精华帖列表 heading", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /digest
		await loginAs("e2etest");
		await page.goto("/digest");
		await page.waitForURL("**/digest");

		// Then: heading renders
		await expect(page.getByText("精华帖列表")).toBeVisible();

		// When: click the level=1 tab if the seed exposes one
		const levelTab = page.locator('a[href*="level=1"]').first();
		const hasLevelTab = await levelTab.isVisible().catch(() => false);

		if (hasLevelTab) {
			await levelTab.click();
			await page.waitForURL(/level=1/);

			// Then: heading still renders (filter didn't crash the page)
			await expect(page.getByText("精华帖列表")).toBeVisible();
		}

		// Cleanup: return to 全部 so we don't leak the filter into other tests.
		const allTab = page.locator('a[href="/digest"]').first();
		if (await allTab.isVisible()) {
			await allTab.click();
			await page.waitForURL("**/digest");
		}
	});

	// -------------------------------------------------------------------------
	// CRUD scenarios — docs/23 §4.3 mandates these sit in .serial blocks so
	// the create → view (Thread) and reply → edit → delete (Post) ordering
	// is preserved under the stateful project.
	// -------------------------------------------------------------------------

	test.describe
		.serial("Thread CRUD", () => {
			let createdThreadUrl = "";

			test("Given I am logged in on a forum page, When I open the new-thread dialog, fill subject + content, and submit, Then I land on the new /threads/<id> page with my subject as the heading", async ({
				page,
				loginAs,
			}) => {
				// Given: authenticated user on the dialog-stable forum
				await loginAs("e2etest");
				const forumPage = new ForumPage(page);
				await forumPage.goto(FORUM_WITH_NEW_THREAD);

				// When: open new-thread dialog
				await forumPage.newThreadButton.click();
				const dialog = page.locator('[role="dialog"]');
				await expect(dialog).toBeVisible();
				await expect(dialog.getByText("发表新帖")).toBeVisible();

				// When: fill subject (validation min 4) + content (min 10)
				const uniqueSubject = `E2E Thread ${Date.now()}`;
				const subjectInput = dialog.locator('input[placeholder*="标题"]');
				await subjectInput.fill(uniqueSubject);

				const editor = dialog.locator('[contenteditable="true"]').first();
				await editor.click();
				await editor.pressSequentially("This is E2E test content, at least 10 chars long.");

				// When: submit
				const submitButton = dialog.getByRole("button", { name: /发布主题/ });
				await submitButton.click();

				// Then: dialog closes, URL advances to /threads/<id>
				await expect(dialog).not.toBeVisible({ timeout: 15_000 });
				await page.waitForURL(/\/threads\/\d+/, { timeout: 15_000 });
				createdThreadUrl = page.url();

				// Then: subject renders as h1
				await expect(page.locator("h1")).toContainText(uniqueSubject);
			});

			test("Given the thread I just created, When I navigate to it directly, Then the heading and the original body text both render", async ({
				page,
				loginAs,
			}) => {
				// biome-ignore lint/suspicious/noSkippedTests: serial dependency on TC-01
				test.skip(!createdThreadUrl, "Thread create scenario must pass first");

				// Given/When: log in and revisit the URL the create flow returned
				await loginAs("e2etest");
				await page.goto(createdThreadUrl);
				await page.waitForLoadState("networkidle");

				// Then: heading present
				await expect(page.locator("h1")).toBeVisible();

				// Then: post body contains the seeded text from TC-01
				const postContent = page.locator(".prose").first();
				await expect(postContent).toBeVisible();
				await expect(postContent).toContainText("E2E test content");
			});
		});

	test.describe
		.serial("Post CRUD", () => {
			test("Given I am logged in on a thread, When I open the reply dialog, type content, and submit, Then my reply appears on the last page of the thread", async ({
				page,
				loginAs,
			}) => {
				// Given: authenticated user on the CRUD-target thread
				await loginAs("e2etest");
				const threadPage = new ThreadPage(page);
				await threadPage.goto(THREAD_FOR_POST_CRUD);

				// When: open reply dialog and wait for TipTap to mount
				await threadPage.replyButton.click();
				await expect(threadPage.replyDialog).toBeVisible();

				const uniqueReply = `E2E Reply ${Date.now()}`;
				const editor = threadPage.replyDialog.locator(".ProseMirror[contenteditable='true']");
				await expect(editor).toBeVisible();
				await editor.click();
				await page.keyboard.type(uniqueReply);

				// When: submit
				const submitBtn = threadPage.replyDialog.getByRole("button", { name: /发送回复/ });
				await submitBtn.click();
				await expect(threadPage.replyDialog).not.toBeVisible({ timeout: 15_000 });

				// Then: navigate to the *last* page via the same ?last=1 contract
				// the reply viewmodel uses, so an accreted seed (>postsPerPage)
				// still lands us where our reply was inserted.
				await page.goto(`/threads/${THREAD_FOR_POST_CRUD}?last=1`);
				await page.waitForLoadState("networkidle");
				await expect(page.getByText(uniqueReply).first()).toBeVisible({ timeout: 10_000 });
			});

			test("Given my reply exists on the last page of the thread, When I click the 编辑 button on my post and submit new content, Then the edit dialog closes successfully", async ({
				page,
				loginAs,
			}) => {
				// Given: authenticated user on the last page where our reply landed
				await loginAs("e2etest");
				await page.goto(`/threads/${THREAD_FOR_POST_CRUD}?last=1`);
				await page.waitForLoadState("networkidle");

				// When: find visible edit buttons (desktop + mobile dual-render)
				const editButtons = page.locator('button:has-text("编辑"):visible');
				const editCount = await editButtons.count();

				// biome-ignore lint/suspicious/noSkippedTests: depends on PR-01 reply being authored by e2etest
				test.skip(editCount === 0, "No editable posts found (PR-01 reply missing)");

				// When: click the last visible 编辑 (our most recent reply)
				await editButtons.last().click();

				const dialog = page.locator('[role="dialog"]:visible');
				await expect(dialog).toBeVisible();
				await expect(dialog.getByText("编辑回复")).toBeVisible();

				// When: replace content
				const editor = dialog.locator(".ProseMirror[contenteditable='true']");
				await expect(editor).toBeVisible();
				await editor.click();
				await page.keyboard.press("Meta+A");
				const editedContent = `Edited E2E Reply ${Date.now()}`;
				await page.keyboard.type(editedContent);

				// When: submit (PostEditor exposes an internal 保存/提交 button)
				const submitBtn = dialog.locator('button:has-text("保存"), button:has-text("提交")');
				if (await submitBtn.isVisible()) {
					await submitBtn.click();
				}

				// Then: edit dialog closes — closure is the proof the edit API succeeded
				await expect(dialog).not.toBeVisible({ timeout: 15_000 });
			});

			test("Given my reply still exists on the last page, When I click 删除 and confirm, Then the post count decreases by one", async ({
				page,
				loginAs,
			}) => {
				// Given: authenticated user on the last page
				await loginAs("e2etest");
				const threadPage = new ThreadPage(page);
				await page.goto(`/threads/${THREAD_FOR_POST_CRUD}?last=1`);
				await page.waitForLoadState("networkidle");

				// When: find visible delete buttons
				const deleteButtons = page.locator('button:has-text("删除"):visible');
				const deleteCount = await deleteButtons.count();

				// biome-ignore lint/suspicious/noSkippedTests: depends on PR-01 reply still existing
				test.skip(deleteCount === 0, "No deletable posts found (PR-01 reply missing)");

				// Snapshot post count for the after-comparison
				const postCountBefore = await threadPage.postCards.count();

				// When: click the last 删除 and confirm in the alertdialog
				await deleteButtons.last().click();
				const confirmDialog = page
					.locator('[role="alertdialog"]:visible, [role="dialog"]:visible')
					.first();
				await expect(confirmDialog).toBeVisible();
				const confirmBtn = confirmDialog.getByRole("button", { name: "删除" });
				await confirmBtn.click();
				await expect(confirmDialog).not.toBeVisible({ timeout: 15_000 });

				// Then: re-fetch the last page (router.refresh is a soft RSC
				// refresh that drops the ?last= query string) and verify count
				// dropped by ≥1.
				await page.goto(`/threads/${THREAD_FOR_POST_CRUD}?last=1`);
				await page.waitForLoadState("networkidle");
				const postCountAfter = await threadPage.postCards.count();
				expect(postCountAfter).toBeLessThan(postCountBefore);
			});
		});
});
