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

	test("purge dialog confirm button stays disabled until username typed", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// D4-d typed-confirm guard. No backend call here — the
		// AdminConfirmDialog disables 彻底清除 until the input matches the
		// current username. We use seed admin (id=1, username "admin",
		// role>0 staff) so we don't even need to snapshot/restore.
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		// Resolve current username from API (avoid hard-coding "admin").
		let username: string;
		{
			const res = await context.request.get("/api/admin/users/1", {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			username = ((await res.json()) as UserResponse).data.username;
		}

		await page.goto("/admin/users/1");
		await expect(page.getByRole("heading", { name: username })).toBeVisible();

		await page.getByTestId("purge-user-button").click();
		const purgeDialog = page.getByRole("dialog", { name: "彻底清除用户" });
		await expect(purgeDialog).toBeVisible();

		const confirmBtn = purgeDialog.getByRole("button", { name: "彻底清除" });
		await expect(confirmBtn).toBeDisabled();

		// Wrong input keeps it disabled.
		const input = purgeDialog.getByPlaceholder("输入用户名以确认");
		await input.fill("not-the-username");
		await expect(confirmBtn).toBeDisabled();

		// Correct input enables it.
		await input.fill(username);
		await expect(confirmBtn).toBeEnabled();

		await purgeDialog.getByRole("button", { name: "取消" }).click();
		await expect(purgeDialog).toBeHidden();
	});

	test("purge of staff user surfaces CANNOT_PURGE_STAFF inline", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// D4-d real-Worker failure path. Seed admin id=1 has role>0 so the
		// Worker rejects with 403 CANNOT_PURGE_STAFF. The UI must surface
		// the error in the dialog and keep the dialog open. No mutation
		// hits the DB on this path, so no afterEach restore is needed.
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		let username: string;
		let role: number;
		{
			const res = await context.request.get("/api/admin/users/1", {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const u = ((await res.json()) as UserResponse).data;
			username = u.username;
			role = u.role;
		}
		expect(role, "seed user id=1 must be staff (role>0) for this test").toBeGreaterThan(0);

		await page.goto("/admin/users/1");
		await expect(page.getByRole("heading", { name: username })).toBeVisible();

		await page.getByTestId("purge-user-button").click();
		const purgeDialog = page.getByRole("dialog", { name: "彻底清除用户" });
		await expect(purgeDialog).toBeVisible();

		await purgeDialog.getByPlaceholder("输入用户名以确认").fill(username);
		await purgeDialog.getByRole("button", { name: "彻底清除" }).click();

		// Error surfaces inside the dialog; dialog stays open.
		const errorBanner = purgeDialog.getByRole("alert");
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText(/CANNOT_PURGE_STAFF|不能.*管理|无法.*清除/);
		await expect(purgeDialog).toBeVisible();

		// User row in DB unchanged.
		{
			const res = await context.request.get("/api/admin/users/1", {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.status).not.toBe(-99);
			expect(after.username).toBe(username);
		}

		await purgeDialog.getByRole("button", { name: "取消" }).click();
	});

	test("purge success flow shows banner with detail counts (mocked)", async ({
		page,
		loginAsAdmin,
	}) => {
		// D4-d success path. We mock both POST /purge AND the GET reload so
		// the page transitions to the tombstone view without touching the
		// real DB. testuser id=3 is regular role=0; mock returns a typical
		// PurgeResult payload.
		await loginAsAdmin();

		// Mock the GET /api/admin/users/3 endpoint — first call returns
		// the live row (so the page can render), subsequent calls (the
		// reload after purge) return the tombstone row.
		const liveUser = {
			id: 3,
			username: "testuser",
			email: "test@example.com",
			avatar: "",
			credits: 0,
			status: 0,
			role: 0,
			threads: 0,
			posts: 0,
			regDate: 0,
			lastLogin: 0,
			regIp: "",
			lastIp: "",
		};
		const tombstoneUser = {
			...liveUser,
			username: "[deleted]",
			email: "",
			status: -99,
			purgedAt: Math.floor(Date.now() / 1000),
			purgedBy: 1,
		};
		let getCalls = 0;
		await page.route("**/api/admin/users/3", async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			getCalls += 1;
			const body = getCalls === 1 ? liveUser : tombstoneUser;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: body,
					meta: { timestamp: Date.now(), requestId: "mock" },
				}),
			});
		});

		// Stub threads/posts list endpoints (filtered by authorId) so the
		// detail tabs don't hit the real backend.
		await page.route(/\/api\/admin\/(threads|posts)\?/, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: [],
					meta: {
						timestamp: Date.now(),
						requestId: "mock",
						total: 0,
						page: 1,
						limit: 20,
						pages: 0,
					},
				}),
			});
		});

		// Mock the POST /purge endpoint.
		await page.route("**/api/admin/users/3/purge", async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						purged: true,
						id: 3,
						deleted: { threads: 2, posts: 5, comments: 3, attachments: 1, messages: 4 },
						audit: { actorEmail: "admin@example.com", actorName: "admin" },
						r2: { deletedCount: 1, failed: [] },
					},
					meta: { timestamp: Date.now(), requestId: "mock" },
				}),
			});
		});

		await page.goto("/admin/users/3");
		await expect(page.getByRole("heading", { name: "testuser" })).toBeVisible();

		await page.getByTestId("purge-user-button").click();
		const purgeDialog = page.getByRole("dialog", { name: "彻底清除用户" });
		await expect(purgeDialog).toBeVisible();
		await purgeDialog.getByPlaceholder("输入用户名以确认").fill("testuser");
		await purgeDialog.getByRole("button", { name: "彻底清除" }).click();

		// Dialog closes, success banner with detail counts appears.
		await expect(purgeDialog).toBeHidden();
		await expect(page.getByText(/已彻底清除该用户/)).toBeVisible();
		await expect(page.getByText(/主题 2 · 帖子 5 · 点评 3 · 附件 1 · 私信 4/)).toBeVisible();

		// After reload, the tombstone-status short-circuit kicks in: the
		// edit/ban/purge buttons disappear and the page shows the muted
		// "此用户已被彻底清除" notice.
		await expect(page.getByText("此用户已被彻底清除，无法再编辑或封禁。")).toBeVisible();
		await expect(page.getByTestId("purge-user-button")).toHaveCount(0);
	});

	test("detail page 查询注册 IP navigates to filtered list with banner", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// D3 path: detail page → list page filtered by reg_ip exact match.
		// We verify (a) URL gets the regIp query param, (b) the list page
		// shows the IP context banner, and (c) the seed user is still
		// visible in the result set (worker exact filter wired up).
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		// Snapshot is read-only here; no mutations, but keep the contract.
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

		// Detail page exposes 查询注册 IP only when user.regIp is non-empty.
		// The seed user must have a reg_ip; if not, this is itself a seed bug.
		const regIpButton = page.getByRole("button", { name: "查询注册 IP" });
		await expect(regIpButton).toBeVisible();
		await regIpButton.click();

		// URL has regIp query param.
		await expect(page).toHaveURL(/\/admin\/users\?regIp=/);
		// IP context banner surfaces ("正在查看注册 IP 为 ...").
		await expect(page.getByText(/正在查看注册 IP 为/)).toBeVisible();
		// Seed user row is still visible in the filtered list.
		await expect(page.getByText(snap.username, { exact: true }).first()).toBeVisible();
	});
});
