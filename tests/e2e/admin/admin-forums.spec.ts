// tests/e2e/admin/admin-forums.spec.ts — A1 admin forums CRUD smoke
//
// End-to-end smoke for the admin /admin/forums page covering the happy path:
//   create → edit → delete a top-level 版块 (type=forum, parent=无上级分区).
//
// Why this scope:
//   - Worker-layer validation branches (bad name, parent missing, has-threads
//     409 on delete, merge, reorder, etc.) are already covered exhaustively
//     by apps/worker/tests/unit/handlers/admin/forum.test.ts. Re-asserting
//     them through the browser would duplicate work without surfacing a
//     different class of bug.
//   - The L3 value here is wiring: dialog opens, form submits, proxy CSRF
//     gate accepts the session, Worker mutation succeeds, page refetches,
//     row appears/disappears. One full create→edit→delete loop exercises
//     all of that.
//   - 409 delete failure is not exercised — the UI hides the 删除 menu item
//     entirely when threads>0 || children>0, so there's no clickable path
//     to that error in the smoke. Failure-envelope coverage belongs to a
//     later response-contract batch.
//
// Selector strategy:
//   - ForumRow is rendered as <div>, NOT a <table>. Do not use role=row/cell.
//   - Each row's MoreHorizontal trigger has aria-label `打开「{name}」操作菜单`
//     so it can be addressed by accessible name even though the icon button
//     is opacity-0 until hover. We click via the accessible name; Playwright
//     auto-scrolls and dispatches via the trigger's accessible handle.
//   - Dialog buttons collide with page buttons by name (e.g. 创建版块 is
//     both the page CTA and the submit button). Always scope inside
//     getByRole("dialog", { name: <title> }).
//   - The confirm dialog's primary button label is 确认 (default), not 删除.
//
// Cleanup:
//   - test.afterEach uses context.request (cookie-bearing) with explicit
//     Origin header to delete the forum via admin proxy. The admin proxy's
//     CSRF gate compares Origin to the request URL host; without it the
//     mutation would 403. We swallow 404 since the happy path already
//     deletes the forum — afterEach exists for early-fail safety.

import { expect, test } from "./fixtures/admin-base";

interface AdminForum {
	id: number;
	name: string;
}

interface ForumListResponse {
	data: AdminForum[];
}

test.describe("Admin forums CRUD", () => {
	// Track the id of the forum created in each test so afterEach can clean
	// it up if the test failed before the explicit DELETE step.
	let createdForumId: number | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		if (createdForumId == null) return;
		const id = createdForumId;
		createdForumId = null;
		try {
			// Admin proxy CSRF gate requires Origin to match the request host.
			// context.request shares cookies with the browser context — the
			// session cookie set by loginAsAdmin() is therefore available.
			const res = await context.request.delete(`/api/admin/forums/${id}`, {
				headers: { Origin: baseURL ?? "http://localhost:7032" },
			});
			// 404 is the success case (test already deleted it).
			if (![200, 204, 404].includes(res.status())) {
				console.warn(`afterEach forum cleanup got status ${res.status()} for id=${id}`);
			}
		} catch (err) {
			console.warn(`afterEach forum cleanup threw for id=${id}:`, err);
		}
	});

	test("create → edit → delete a top-level 版块", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		await loginAsAdmin();
		await page.goto("/admin/forums");

		// Wait for the page to finish initial load — the heading is always
		// rendered, the "加载中..." block is replaced by the tree once data
		// arrives.
		await expect(page.getByRole("heading", { name: "版块管理" })).toBeVisible();
		await expect(page.getByText("加载中...")).toBeHidden();

		// ── CREATE ─────────────────────────────────────────────────────
		const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const initialName = `L3测试版块_${uniqueSuffix}`;

		// Page-level CTA — text is unique on the page when no dialog is open.
		await page.getByRole("button", { name: "创建版块" }).first().click();

		const createDialog = page.getByRole("dialog", { name: "创建版块" });
		await expect(createDialog).toBeVisible();
		// Dialog defaults type=forum, parentId=0 (无上级分区) — leave as is.
		await createDialog.getByLabel("名称").fill(initialName);
		await createDialog.getByRole("button", { name: "创建版块" }).click();

		// Dialog closes; row appears in the list.
		await expect(createDialog).toBeHidden();
		await expect(page.getByText(initialName, { exact: true })).toBeVisible();

		// Resolve the forum id by name via the admin proxy so afterEach has
		// it even if the rest of the test crashes.
		{
			const res = await context.request.get("/api/admin/forums", {
				headers: { Origin: baseURL ?? "http://localhost:7032" },
			});
			expect(res.ok()).toBeTruthy();
			const body = (await res.json()) as ForumListResponse;
			const created = body.data.find((f) => f.name === initialName);
			expect(
				created,
				`forum "${initialName}" should be returned by GET /api/admin/forums`,
			).toBeTruthy();
			createdForumId = created?.id ?? null;
			expect(createdForumId).not.toBeNull();
		}

		// ── EDIT ───────────────────────────────────────────────────────
		const editedName = `${initialName}_edited`;
		await page.getByRole("button", { name: `打开「${initialName}」操作菜单` }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑版块" });
		await expect(editDialog).toBeVisible();
		await editDialog.getByLabel("名称").fill(editedName);
		await editDialog.getByRole("button", { name: "保存" }).click();

		await expect(editDialog).toBeHidden();
		await expect(page.getByText(editedName, { exact: true })).toBeVisible();
		await expect(page.getByText(initialName, { exact: true })).toBeHidden();

		// ── DELETE ─────────────────────────────────────────────────────
		await page.getByRole("button", { name: `打开「${editedName}」操作菜单` }).click();
		await page.getByRole("menuitem", { name: "删除" }).click();

		const confirmDialog = page.getByRole("dialog", { name: "删除版块" });
		await expect(confirmDialog).toBeVisible();
		await confirmDialog.getByRole("button", { name: "确认" }).click();

		await expect(confirmDialog).toBeHidden();
		await expect(page.getByText(editedName, { exact: true })).toBeHidden();

		// Happy path completed — afterEach DELETE will be a no-op (404).
	});
});
