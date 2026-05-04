// tests/e2e/admin/admin-users.spec.ts — D2 admin users smoke
//
// Single-record idempotent tests on /admin/users for seed user id=3
// (testuser, role=会员).
//
// Scope after D2 list-menu collapse
//   The per-row action menu now only exposes 查看详情 + 编辑.
//   封禁 / 解除封禁 live on the detail page (/admin/users/[id]).
//   封禁并删除内容 / 彻底清除 ship in D4.
//
// Tests
//   1. edit credits via list menu — bump +1, verify via API.
//   2. ban → unban on detail page — open detail, click 封禁用户,
//      confirm dialog, assert 已封禁; then 解除封禁, assert 正常.
//   3. list → 查看详情 → detail loads → switch tabs → back.
//   4. username conflict in list edit dialog still surfaces inline
//      error and keeps dialog open.
//   5. List action menu fits viewport (D1 layout regression guard,
//      now with the collapsed 查看详情 + 编辑 set).
//
// Cleanup
//   - afterEach PATCHes the snapshot back via /api/admin/users/3 with
//     all fields so any mid-test crash leaves the row identical to
//     start. PATCH is idempotent.
//
// Selectors
//   - Per-row trigger aria-label: 打开用户「{username}」操作菜单
//   - 当前积分 Label has a sibling formatted-value span; locate input
//     by id (#edit-credits / #edit-username) directly.
//   - Detail-page 解除封禁 is a plain Button (no dialog).

import { expect, test } from "./fixtures/admin-base";

const SEED_USER_ID = 3; // testuser, role=会员

interface AdminUser {
	id: number;
	username: string;
	email: string;
	avatar: string;
	credits: number;
	status: number;
	role: number;
}

interface UserResponse {
	data: AdminUser;
}

test.describe("Admin users CRUD", () => {
	let snapshot: AdminUser | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		if (!snapshot) return;
		const snap = snapshot;
		snapshot = null;
		const origin = baseURL ?? "http://localhost:7032";
		try {
			const res = await context.request.patch(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin, "Content-Type": "application/json" },
				data: {
					username: snap.username,
					email: snap.email,
					avatar: snap.avatar,
					credits: snap.credits,
					status: snap.status,
					role: snap.role,
				},
			});
			if (!res.ok()) {
				console.warn(`afterEach user restore got status ${res.status()}`);
			}
		} catch (err) {
			console.warn("afterEach user restore threw:", err);
		}
	});

	test("edit credits via list menu", async ({ context, page, loginAsAdmin, baseURL }) => {
		const origin = baseURL ?? "http://localhost:7032";

		// Mint admin session BEFORE any admin proxy GET (proxy gates GET too).
		await loginAsAdmin();

		// Snapshot for afterEach rollback.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok(), "GET /api/admin/users/:id should succeed").toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		if (!snap) throw new Error("unreachable: snapshot asserted truthy");
		const initialUsername = snap.username;
		const initialCredits = snap.credits;

		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
		await expect(page.getByText(initialUsername, { exact: true }).first()).toBeVisible();

		const triggerName = `打开用户「${initialUsername}」操作菜单`;
		await page.getByRole("button", { name: triggerName }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();
		const newCredits = initialCredits + 1;
		const creditsInput = editDialog.locator("#edit-credits");
		await creditsInput.fill(String(newCredits));
		await editDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(editDialog).toBeHidden();

		// Verify via API — table doesn't show credits column directly.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.credits).toBe(newCredits);
			expect(after.username).toBe(initialUsername);
		}
	});

	test("ban → unban via detail page", async ({ context, page, loginAsAdmin, baseURL }) => {
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		// Snapshot first so afterEach can restore unconditionally.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		if (!snap) throw new Error("snapshot must be present");

		await page.goto(`/admin/users/${SEED_USER_ID}`);
		await expect(page.getByRole("heading", { name: snap.username })).toBeVisible();
		// Pre-condition: user starts in normal state (seed invariant).
		await expect(page.getByText("正常", { exact: true })).toBeVisible();

		// ── BAN: opens AdminConfirmDialog, then confirm ────────────────
		await page.getByRole("button", { name: "封禁用户" }).click();
		const banDialog = page.getByRole("dialog", { name: "封禁用户" });
		await expect(banDialog).toBeVisible();
		await banDialog.getByRole("button", { name: "确认" }).click();
		await expect(banDialog).toBeHidden();

		// Status badge flips to 已封禁; success banner surfaces.
		await expect(page.getByText("已封禁", { exact: true })).toBeVisible();
		await expect(page.getByText(`已封禁 ${snap.username}`)).toBeVisible();
		// 封禁用户 button hides; 解除封禁 surfaces.
		await expect(page.getByRole("button", { name: "封禁用户" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "解除封禁" })).toBeVisible();

		// Verify backend.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.status).toBe(-1);
		}

		// ── UNBAN: plain Button, no confirm dialog ─────────────────────
		await page.getByRole("button", { name: "解除封禁" }).click();
		await expect(page.getByText("正常", { exact: true })).toBeVisible();
		await expect(page.getByText(`已解除封禁 ${snap.username}`)).toBeVisible();
		await expect(page.getByRole("button", { name: "解除封禁" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "封禁用户" })).toBeVisible();

		// Verify backend back to 0.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.status).toBe(0);
		}
	});

	test("list 查看详情 navigates to detail page with tabs", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		if (!snap) throw new Error("snapshot must be present");
		const initialUsername = snap.username;

		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
		await expect(page.getByText(initialUsername, { exact: true }).first()).toBeVisible();

		const triggerName = `打开用户「${initialUsername}」操作菜单`;
		await page.getByRole("button", { name: triggerName }).click();
		await page.getByRole("menuitem", { name: "查看详情" }).click();

		await expect(page).toHaveURL(`/admin/users/${SEED_USER_ID}`);
		await expect(page.getByRole("heading", { name: initialUsername })).toBeVisible();
		await expect(page.getByText("基本资料", { exact: true })).toBeVisible();
		await expect(page.getByText("元信息", { exact: true })).toBeVisible();

		// Switch to 帖子 tab and back.
		await page.getByRole("tab", { name: /帖子/ }).click();
		await page.getByRole("tab", { name: /主题/ }).click();

		// Back link returns to the list.
		await page.getByRole("button", { name: "返回用户列表" }).click();
		await expect(page).toHaveURL("/admin/users");
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
	});

	test("edit username conflict surfaces inline error and keeps dialog open", async ({
		page,
		context,
		loginAsAdmin,
		baseURL,
	}) => {
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		if (!snap) throw new Error("snapshot must be present");
		const initialUsername = snap.username;

		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
		await expect(page.getByText(initialUsername, { exact: true }).first()).toBeVisible();

		const triggerName = `打开用户「${initialUsername}」操作菜单`;
		await page.getByRole("button", { name: triggerName }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();

		const usernameInput = editDialog.locator("#edit-username");
		await usernameInput.fill("e2etest");
		await editDialog.getByRole("button", { name: "保存更改" }).click();

		const errorBanner = editDialog.getByRole("alert");
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText(/Username is already taken|USERNAME_TAKEN/);
		await expect(editDialog).toBeVisible();

		const saveBtn = editDialog.getByRole("button", { name: "保存更改" });
		await expect(saveBtn).toBeEnabled();

		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.username).toBe(initialUsername);
		}

		await editDialog.getByRole("button", { name: "取消" }).click();
		await expect(editDialog).toBeHidden();
	});

	test("user row action menu fits content within viewport", async ({
		page,
		context,
		loginAsAdmin,
		baseURL,
	}) => {
		// D1 layout regression guard. After D2 the menu only contains
		// 查看详情 + 编辑, but we keep the bbox check so any future
		// re-expansion still has to land on a single line per item.
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		if (!snap) throw new Error("snapshot must be present");
		const initialUsername = snap.username;

		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();

		const triggerName = `打开用户「${initialUsername}」操作菜单`;
		await page.getByRole("button", { name: triggerName }).click();

		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();

		const viewport = page.viewportSize();
		expect(viewport, "viewport size must be available").not.toBeNull();
		if (!viewport) throw new Error("unreachable");

		const menuItems = menu.getByRole("menuitem");
		const count = await menuItems.count();
		expect(count, "users action menu must render at least one item").toBeGreaterThan(0);

		for (let i = 0; i < count; i++) {
			const item = menuItems.nth(i);
			const text = (await item.textContent())?.trim() ?? "";
			const bbox = await item.boundingBox();
			expect(bbox, `menuitem #${i} ("${text}") must have a bbox`).not.toBeNull();
			if (!bbox) continue;
			expect(bbox.x, `menuitem "${text}" must start inside viewport`).toBeGreaterThanOrEqual(0);
			expect(
				bbox.x + bbox.width,
				`menuitem "${text}" must not overflow viewport right edge`,
			).toBeLessThanOrEqual(viewport.width);
			expect(
				bbox.height,
				`menuitem "${text}" must render on a single line (no wrap)`,
			).toBeLessThanOrEqual(40);
		}
	});
});
