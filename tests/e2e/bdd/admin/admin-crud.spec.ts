// tests/e2e/bdd/admin/admin-crud.spec.ts — Feature: Admin CRUD surfaces (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 4.2), §4.3 (CRUD protection),
//      §5.3 (合并表)
//
// Merges 5 legacy admin specs (admin-users 9 + admin-logs 4 + admin-reports 2
// + admin-forums 1 + admin-threads 1 = 17 tests) into a single BDD file with
// 14 scenarios across 5 Feature blocks. 3 merges:
//   M1 (Admin Users): purge typed-confirm gating + staff CANNOT_PURGE_STAFF
//                     fold into one scenario — both setup /admin/users/1,
//                     both open the same purge dialog, and the gating check
//                     is a strict prefix of the failure-path assertion.
//   M2 (Admin Operation Logs): JSON pretty-print + non-JSON fallback share
//                              the same /api/admin/admin-logs** mock and only
//                              differ in which row's 查看详情 button you click.
//   M3 (Admin Reports): list-renders + type-filter share the same mock and
//                       the same initial render, then filter is the natural
//                       next assertion.
//
// UI-drift notes (verified against apps/admin/src/app/(admin)/admin/users/page.tsx
// and apps/admin/src/components/admin/user-detail-panel.tsx as of this commit):
//   - Users list per-row action menu (legacy `打开用户「X」操作菜单`) was
//     replaced by inline Eye + Pencil icon buttons in commit e27637e9.
//     Scenarios that opened that menu now click the direct buttons:
//     `查看用户「X」详情` and `编辑用户「X」`.
//   - The 查看详情 path now opens an in-page `<UserDetailDialog>` instead of
//     navigating to `/admin/users/[id]`. The deep-link route is preserved
//     (purge scenarios still hit /admin/users/1 directly).
//   - The purge dialog uses `AdminConfirmDialog` with `requireInput="ok"`
//     and placeholder `输入 ok 以确认` — the typed-confirm token is the
//     literal "ok", not the target username.
//   - The detail-page "search by IP" button was renamed from `查询注册 IP`
//     to `搜索同 IP 用户` (per-IP-row layout in commit bfb1f9cd) and only
//     surfaces when `user.regIp` is non-empty; the testuser scenario PATCHes
//     a reg_ip in before clicking and the afterEach restores it.
//
// Project: collected by the `admin` Playwright project (port 7032). Stage 1
// admin testMatch (/\/(admin\/[^/]+|bdd\/admin\/[^/]+)\.spec\.ts$/) already
// picks up files under tests/e2e/bdd/admin/.
//
// Fixtures: imports from ../../admin/fixtures/admin-base — same source as the
// legacy specs, so AUTH_SECRET / ADMIN_EMAILS / Auth.js cookie minting is
// unchanged. Per-Feature beforeEach/afterEach mirror the legacy setup/cleanup
// scoped to the relevant block (snapshot+restore for Users/Threads, in-memory
// mocks for Logs/Reports, post-loop cleanup for Forums).
//
// Traceability map lives in the commit message body.

import { expect, test } from "../../admin/fixtures/admin-base";

// =============================================================================
// Feature: Admin Users CRUD (9 legacy tests → 8 scenarios; M1 merges US-06+US-07)
// =============================================================================

const SEED_USER_ID = 3; // testuser, role=会员

interface AdminUser {
	id: number;
	username: string;
	email: string;
	avatar: string;
	credits: number;
	status: number;
	role: number;
	regIp: string;
	lastIp: string;
}

interface UserResponse {
	data: AdminUser;
}

test.describe("Feature: Admin Users CRUD", () => {
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
					regIp: snap.regIp,
					lastIp: snap.lastIp,
				},
			});
			if (!res.ok()) {
				console.warn(`afterEach user restore got status ${res.status()}`);
			}
		} catch (err) {
			console.warn("afterEach user restore threw:", err);
		}
	});

	test("Given the user list, When I bump credits via the list-row 编辑 dialog, Then the API reflects the new value", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Given: admin session + snapshot for rollback (legacy US-01)
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

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

		// When: open the list row's 编辑 dialog via the direct Pencil icon
		// (legacy action-menu was replaced by inline icons in commit e27637e9
		// "feat(admin): open user detail in wide dialog from users list").
		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
		await expect(page.getByText(initialUsername, { exact: true }).first()).toBeVisible();

		await page.getByRole("button", { name: `编辑用户「${initialUsername}」` }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();
		const newCredits = initialCredits + 1;
		const creditsInput = editDialog.locator("#edit-credits");
		await creditsInput.fill(String(newCredits));
		await editDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(editDialog).toBeHidden();

		// Then: API GET confirms the new credits value (table doesn't show credits)
		const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
			headers: { Origin: origin },
		});
		expect(res.ok()).toBeTruthy();
		const after = ((await res.json()) as UserResponse).data;
		expect(after.credits).toBe(newCredits);
		expect(after.username).toBe(initialUsername);
	});

	test("Given a normal user on the detail page, When I 封禁 and then 解除封禁, Then the status badge + backend status flip accordingly", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Given: admin session + snapshot (legacy US-02)
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

		await page.goto(`/admin/users/${SEED_USER_ID}`);
		await expect(page.getByRole("heading", { name: snap.username })).toBeVisible();
		await expect(page.getByText("正常", { exact: true })).toBeVisible();

		// When: 封禁 → confirm dialog → 确认
		await page.getByRole("button", { name: "封禁用户" }).click();
		const banDialog = page.getByRole("dialog", { name: "封禁用户" });
		await expect(banDialog).toBeVisible();
		await banDialog.getByRole("button", { name: "确认" }).click();
		await expect(banDialog).toBeHidden();

		// Then: UI flips to 已封禁 + 解除封禁 surfaces
		await expect(page.getByText("已封禁", { exact: true })).toBeVisible();
		await expect(page.getByText(`已封禁 ${snap.username}`)).toBeVisible();
		await expect(page.getByRole("button", { name: "封禁用户" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "解除封禁" })).toBeVisible();

		// Then: backend status flipped to -1
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.status).toBe(-1);
		}

		// When: 解除封禁 (plain button, no confirm dialog)
		await page.getByRole("button", { name: "解除封禁" }).click();

		// Then: UI returns to 正常 + 封禁用户 surfaces again
		await expect(page.getByText("正常", { exact: true })).toBeVisible();
		await expect(page.getByText(`已解除封禁 ${snap.username}`)).toBeVisible();
		await expect(page.getByRole("button", { name: "解除封禁" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "封禁用户" })).toBeVisible();

		// Then: backend status returns to 0
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok()).toBeTruthy();
			const after = ((await res.json()) as UserResponse).data;
			expect(after.status).toBe(0);
		}
	});

	test("Given the user list, When I click the row 查看详情 icon, Then the 用户详情 dialog opens and dismisses without leaving the list", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Given: admin session + snapshot read for the username (legacy US-03).
		// Commit e27637e9 (May 21) replaced the in-row 查看详情 menuitem +
		// 返回用户列表 navigation with a wide in-page dialog wrapping
		// `UserDetailPanel`. The list page's URL never changes, so the
		// "back link returns to the list" assertion is now "dialog closes
		// and the list still renders". Tab switching inside the panel
		// continues to validate the same content-tabs SegmentedSwitch path.
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

		// When: click the row's 查看详情 Eye icon
		await page.getByRole("button", { name: `查看用户「${initialUsername}」详情` }).click();

		// Then: detail dialog opens with the panel content (URL stays on /admin/users)
		const detailDialog = page.getByRole("dialog", { name: "用户详情" });
		await expect(detailDialog).toBeVisible();
		await expect(detailDialog.getByRole("heading", { name: initialUsername })).toBeVisible();
		await expect(detailDialog.getByText("基本资料", { exact: true })).toBeVisible();
		await expect(detailDialog.getByText("元信息", { exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/admin\/users(\?|$)/);

		// When/Then: SegmentedSwitch toggles content tabs without crashing
		await detailDialog.getByRole("tab", { name: /帖子/ }).click();
		await detailDialog.getByRole("tab", { name: /主题/ }).click();

		// When: dismiss the dialog with Escape
		await page.keyboard.press("Escape");

		// Then: dialog hidden, list page still rendered
		await expect(detailDialog).toBeHidden();
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
	});

	test("Given the edit dialog, When I submit a username that already exists, Then an inline error surfaces and the dialog stays open", async ({
		page,
		context,
		loginAsAdmin,
		baseURL,
	}) => {
		// Given: admin session + snapshot (legacy US-04)
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

		await page.getByRole("button", { name: `编辑用户「${initialUsername}」` }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();

		// When: submit a username that collides with another user (e2etest)
		const usernameInput = editDialog.locator("#edit-username");
		await usernameInput.fill("e2etest");
		await editDialog.getByRole("button", { name: "保存更改" }).click();

		// Then: inline alert surfaces with the conflict message
		const errorBanner = editDialog.getByRole("alert");
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText(/Username is already taken|USERNAME_TAKEN/);
		await expect(editDialog).toBeVisible();

		// Then: save button is re-enabled (not stuck in submitting state)
		const saveBtn = editDialog.getByRole("button", { name: "保存更改" });
		await expect(saveBtn).toBeEnabled();

		// Then: DB unchanged
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

	test("Given the user list, Then every row's action icons fit inside the viewport on a single row", async ({
		page,
		context,
		loginAsAdmin,
		baseURL,
	}) => {
		// Legacy US-05 was the D1 "action menu items fit inside viewport"
		// guard, but commit e27637e9 replaced the per-row action menu with
		// inline 查看详情 / 编辑 icon buttons. The original layout-overflow
		// concern is now about that icon row, so the scenario is adapted
		// rather than dropped: assert the inline action buttons render on a
		// single line inside the viewport's right edge for the seed row.
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

		const viewport = page.viewportSize();
		expect(viewport, "viewport size must be available").not.toBeNull();
		if (!viewport) throw new Error("unreachable");

		const actionButtons = [
			page.getByRole("button", { name: `查看用户「${initialUsername}」详情` }),
			page.getByRole("button", { name: `编辑用户「${initialUsername}」` }),
		];

		for (const button of actionButtons) {
			await expect(button).toBeVisible();
			const bbox = await button.boundingBox();
			const label = await button.getAttribute("aria-label");
			expect(bbox, `action button "${label}" must have a bbox`).not.toBeNull();
			if (!bbox) continue;
			expect(bbox.x, `action button "${label}" must start inside viewport`).toBeGreaterThanOrEqual(
				0,
			);
			expect(
				bbox.x + bbox.width,
				`action button "${label}" must not overflow viewport right edge`,
			).toBeLessThanOrEqual(viewport.width);
			// Icon buttons are h-8 (32px) in the source; allow generous
			// breathing room before flagging multi-line layout.
			expect(
				bbox.height,
				`action button "${label}" must render on a single row (no wrap)`,
			).toBeLessThanOrEqual(40);
		}
	});

	test("Given the purge dialog for a staff user, When I type the wrong then the right token and submit, Then 彻底清除 toggles enabled state and the backend rejects with CANNOT_PURGE_STAFF", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Merges legacy US-06 (D4-d typed-confirm gating) + US-07 (D4-d staff
		// rejection failure path). Both setup /admin/users/1 and both interact
		// with the same purge dialog; the gating check is a strict prefix of
		// the failure-path assertion, so splitting would re-pay goto + dialog
		// open without surfacing a distinct branch.
		//
		// Typed-confirm uses the literal token "ok" (AdminConfirmDialog
		// requireInput="ok"), not the username — UserDetailPanel passes
		// requireInput="ok" / inputPlaceholder="输入 ok 以确认".
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		// Resolve the seed admin's current username + verify role>0 (staff invariant).
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
		expect(role, "seed user id=1 must be staff (role>0) for this scenario").toBeGreaterThan(0);

		// Given: on the staff user's detail page with the purge dialog open
		await page.goto("/admin/users/1");
		await expect(page.getByRole("heading", { name: username })).toBeVisible();

		await page.getByTestId("purge-user-button").click();
		const purgeDialog = page.getByRole("dialog", { name: "彻底清除用户" });
		await expect(purgeDialog).toBeVisible();

		const confirmBtn = purgeDialog.getByRole("button", { name: "彻底清除" });
		const input = purgeDialog.getByPlaceholder("输入 ok 以确认");

		// Then: confirm button starts disabled (US-06 gating prefix)
		await expect(confirmBtn).toBeDisabled();

		// When/Then: wrong input keeps it disabled
		await input.fill("not-ok");
		await expect(confirmBtn).toBeDisabled();

		// When/Then: correct token "ok" enables it
		await input.fill("ok");
		await expect(confirmBtn).toBeEnabled();

		// When: submit against a staff user
		await confirmBtn.click();

		// Then: inline error surfaces (US-07 failure path) and dialog stays open
		const errorBanner = purgeDialog.getByRole("alert");
		await expect(errorBanner).toBeVisible();
		// Worker's getStatusMessage table does not map CANNOT_PURGE_STAFF (gap
		// pre-dates this migration), so the admin client surfaces the generic
		// "An error occurred" fallback. The real safety net for this scenario
		// is the DB-unchanged assertion below — banner just confirms an error
		// rendered. Keep the localized variants in case worker adds a message
		// later; do not narrow without also fixing worker error.ts.
		await expect(errorBanner).toContainText(
			/CANNOT_PURGE_STAFF|不能.*管理|无法.*清除|An error occurred|操作失败/,
		);
		await expect(purgeDialog).toBeVisible();

		// Then: DB row is unchanged
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

	test("Given a mocked purge response, When I 彻底清除 testuser, Then the success banner shows detail counts and the tombstone short-circuit hides edit/ban", async ({
		page,
		loginAsAdmin,
	}) => {
		// Mock-only success path (legacy US-08). Real Worker DELETE would
		// require external reseed; mocking keeps the assertion focused on UI
		// transitions (banner + tombstone short-circuit).
		await loginAsAdmin();

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

		// Stub the per-tab list endpoints so detail-page tabs don't hit the real backend.
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

		// Given: live testuser detail page
		await page.goto("/admin/users/3");
		await expect(page.getByRole("heading", { name: "testuser" })).toBeVisible();

		// When: open purge dialog, type the typed-confirm token "ok", submit
		await page.getByTestId("purge-user-button").click();
		const purgeDialog = page.getByRole("dialog", { name: "彻底清除用户" });
		await expect(purgeDialog).toBeVisible();
		await purgeDialog.getByPlaceholder("输入 ok 以确认").fill("ok");
		await purgeDialog.getByRole("button", { name: "彻底清除" }).click();

		// Then: success banner with detail counts
		await expect(purgeDialog).toBeHidden();
		await expect(page.getByText(/已彻底清除该用户/)).toBeVisible();
		await expect(page.getByText(/主题 2 · 帖子 5 · 点评 3 · 附件 1 · 私信 4/)).toBeVisible();

		// Then: tombstone short-circuit hides edit/ban + shows muted notice
		await expect(page.getByText("此用户已被彻底清除，无法再编辑或封禁。")).toBeVisible();
		await expect(page.getByTestId("purge-user-button")).toHaveCount(0);
	});

	test("Given a user with a regIp on the detail page, When I click 搜索同 IP 用户, Then the list opens filtered by regIp and the IP-context banner renders", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Legacy US-09 (D3 path). The 同 IP 用户 entry button only renders
		// when `user.regIp` is non-empty (UserDetailPanel), but the seed
		// testuser has reg_ip="" — so we PATCH a reg_ip in first and
		// restore it via the suite afterEach (snapshot includes regIp).
		// Button name was renamed from "查询注册 IP" → "搜索同 IP 用户"
		// when the per-IP-row layout landed (bfb1f9cd "feat(admin): wire
		// 搜索同 IP 用户 button on user detail panel").
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

		// Inject a regIp so the conditional 搜索同 IP 用户 button surfaces.
		const TEST_REG_IP = "203.0.113.42";
		{
			const res = await context.request.patch(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin, "Content-Type": "application/json" },
				data: {
					username: snap.username,
					email: snap.email,
					avatar: snap.avatar,
					credits: snap.credits,
					status: snap.status,
					role: snap.role,
					regIp: TEST_REG_IP,
					lastIp: snap.lastIp,
				},
			});
			expect(res.ok(), "PATCH should succeed when injecting regIp").toBeTruthy();
		}

		await page.goto(`/admin/users/${SEED_USER_ID}`);
		await expect(page.getByRole("heading", { name: snap.username })).toBeVisible();

		// When: click 搜索同 IP 用户 — first occurrence is the reg_ip row
		const regIpButton = page.getByRole("button", { name: "搜索同 IP 用户" }).first();
		await expect(regIpButton).toBeVisible();
		await regIpButton.click();

		// Then: URL filter + banner + seed row still in result set
		await expect(page).toHaveURL(/\/admin\/users\?regIp=/);
		await expect(page.getByText(/正在查看注册 IP 为/)).toBeVisible();
		await expect(page.getByText(snap.username, { exact: true }).first()).toBeVisible();
	});
});

// =============================================================================
// Feature: Admin Operation Logs (4 legacy tests → 3 scenarios; M2 merges LG-03+LG-04)
// =============================================================================

const NOW = Math.floor(Date.UTC(2026, 4, 5, 6, 0, 0) / 1000); // 2026-05-05T06:00:00Z

interface AdminLogFixture {
	id: number;
	adminId: number;
	adminName: string;
	action: string;
	targetType: string;
	targetId: number | null;
	details: string;
	ip: string;
	createdAt: number;
}

const LOG_FIXTURE: AdminLogFixture[] = [
	{
		id: 101,
		adminId: 1,
		adminName: "alice",
		action: "user.ban",
		targetType: "user",
		targetId: 3,
		details: JSON.stringify({ reason: "spam", actorEmail: "alice@example.com" }),
		ip: "10.0.0.1",
		createdAt: NOW,
	},
	{
		id: 102,
		adminId: 1,
		adminName: "alice",
		action: "forum.reorder",
		targetType: "forum",
		targetId: null,
		details: JSON.stringify({
			count: 2,
			orders: [
				{ id: 10, before: 1, after: 2 },
				{ id: 11, before: 2, after: 1 },
			],
		}),
		ip: "10.0.0.1",
		createdAt: NOW - 60,
	},
	{
		id: 103,
		adminId: 2,
		adminName: "bob",
		action: "setting.update",
		targetType: "setting",
		targetId: null,
		details: "legacy plain text payload, not json",
		ip: "10.0.0.2",
		createdAt: NOW - 120,
	},
];

test.describe("Feature: Admin Operation Logs", () => {
	let lastRequestUrl = "";

	test.beforeEach(async ({ page, loginAsAdmin }) => {
		await loginAsAdmin();
		lastRequestUrl = "";
		await page.route("**/api/admin/admin-logs**", async (route) => {
			const url = new URL(route.request().url());
			lastRequestUrl = url.toString();
			const actionFilter = url.searchParams.get("action");
			const filtered = actionFilter
				? LOG_FIXTURE.filter((row) => row.action === actionFilter)
				: LOG_FIXTURE;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: filtered,
					meta: {
						page: 1,
						pages: 1,
						total: filtered.length,
						limit: 20,
						timestamp: Date.now(),
						requestId: "e2e-mock",
					},
				}),
			});
		});
	});

	// Tear down the mock so later admin scenarios that hit /api/admin/admin-logs**
	// (e.g. the action sidebar making a count probe) go to the real Worker.
	// Reviewer caution: avoid polluting subsequent admin CRUD closed loops.
	test.afterEach(async ({ page }) => {
		await page.unroute("**/api/admin/admin-logs**");
	});

	test("Given the operation logs page, Then all three rows render with action codes, IPs, and whitelisted vs plain target rendering", async ({
		page,
	}) => {
		// Legacy LG-01
		await page.goto("/admin/logs/operations");

		await expect(page.getByRole("heading", { name: "操作日志" })).toBeVisible();

		// Then: action codes render
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();
		await expect(page.getByText("forum.reorder", { exact: true })).toBeVisible();
		await expect(page.getByText("setting.update", { exact: true })).toBeVisible();

		// Then: whitelisted target types render as links
		const userLink = page.getByRole("link", { name: "user#3" });
		await expect(userLink).toBeVisible();
		await expect(userLink).toHaveAttribute("href", "/admin/users/3");

		const forumLink = page.getByRole("link", { name: "forum" });
		await expect(forumLink).toBeVisible();
		await expect(forumLink).toHaveAttribute("href", "/admin/forums");

		// Then: non-whitelisted targetType (setting) renders as plain text in
		// the row (NOT a link). Scope to the data table to avoid matching the
		// targetType <option> in the filter dropdown.
		const settingCell = page.locator("table").getByText("setting", { exact: true });
		await expect(settingCell.first()).toBeVisible();
		await expect(page.getByRole("link", { name: "setting", exact: true })).toHaveCount(0);

		// Then: IP column rendered
		await expect(page.getByText("10.0.0.1").first()).toBeVisible();
		await expect(page.getByText("10.0.0.2").first()).toBeVisible();
	});

	test("Given the operation logs page, When I filter by action=user.ban, Then the request URL carries ?action= and only matching rows remain", async ({
		page,
	}) => {
		// Legacy LG-02
		await page.goto("/admin/logs/operations");
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		// When: fill the search input and submit
		const searchInput = page.getByPlaceholder("如 user.ban，回车提交");
		await searchInput.fill("user.ban");
		await searchInput.press("Enter");

		// Then: list narrows to the matching row only
		await expect(page.getByText("forum.reorder", { exact: true })).toHaveCount(0);
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		// Then: the mock observed the action filter on the request URL
		expect(lastRequestUrl).toContain("action=user.ban");
	});

	test("Given the operation logs list, When I open a JSON-details row and then a non-JSON row, Then the detail dialog pretty-prints JSON for the first and falls back to raw text with a marker for the second", async ({
		page,
	}) => {
		// Merges legacy LG-03 (JSON pretty-print on #101) + LG-04 (non-JSON
		// fallback on #103). Both share the same /api/admin/admin-logs** mock
		// and the same page. Splitting them would only re-pay the goto +
		// initial-render wait — the dialog open/close interactions are the
		// only differentiator.
		await page.goto("/admin/logs/operations");
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		// When: open #101 (JSON-typed details)
		await page.getByLabel("查看日志 #101 详情").click();
		const dialog101 = page.getByRole("dialog", { name: "操作日志详情" });
		await expect(dialog101).toBeVisible();

		// Then: pretty-printed JSON (newlines + indentation), no parse-failure marker
		const pre101 = dialog101.getByTestId("admin-log-details");
		await expect(pre101).toBeVisible();
		const text101 = (await pre101.textContent()) ?? "";
		expect(text101).toContain("\n");
		expect(text101).toContain('"reason"');
		expect(text101).toContain('"spam"');
		await expect(dialog101.getByText("(原始文本，非 JSON)")).toHaveCount(0);

		await dialog101.getByRole("button", { name: "关闭" }).click();
		await expect(dialog101).toBeHidden();

		// When: open #103 (non-JSON details)
		await expect(page.getByText("setting.update", { exact: true })).toBeVisible();
		await page.getByLabel("查看日志 #103 详情").click();
		const dialog103 = page.getByRole("dialog", { name: "操作日志详情" });
		await expect(dialog103).toBeVisible();

		// Then: parse-failure annotation + raw payload preserved verbatim
		await expect(dialog103.getByText("(原始文本，非 JSON)")).toBeVisible();
		const pre103 = dialog103.getByTestId("admin-log-details");
		await expect(pre103).toContainText("legacy plain text payload, not json");
	});
});

// =============================================================================
// Feature: Admin Reports List (2 legacy tests → 1 scenario; M3 merges RP-01+RP-02)
// =============================================================================

interface AdminReport {
	id: number;
	type: "thread" | "post" | "user";
	targetId: number;
	reporterId: number;
	reporterName: string;
	reason: string;
	status: "pending" | "resolved" | "dismissed";
	handlerId: number | null;
	handlerName: string;
	handledAt: number | null;
	createdAt: number;
	threadId: number | null;
	targetTitle: string | null;
	targetName: string | null;
}

const NOW_REPORTS = Math.floor(Date.now() / 1000);

const REPORT_FIXTURE: AdminReport[] = [
	{
		id: 1,
		type: "thread",
		targetId: 11,
		reporterId: 5,
		reporterName: "alice",
		reason: "垃圾广告",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW_REPORTS,
		threadId: 11,
		targetTitle: "测试主题标题",
		targetName: null,
	},
	{
		id: 2,
		type: "post",
		targetId: 22,
		reporterId: 5,
		reporterName: "alice",
		reason: "违规内容",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW_REPORTS,
		threadId: 33,
		targetTitle: "回帖所在主题",
		targetName: null,
	},
	{
		id: 3,
		type: "user",
		targetId: 44,
		reporterId: 5,
		reporterName: "alice",
		reason: "人身攻击",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW_REPORTS,
		threadId: null,
		targetTitle: null,
		targetName: "bob",
	},
];

test.describe("Feature: Admin Reports List", () => {
	test.beforeEach(async ({ page, loginAsAdmin }) => {
		await loginAsAdmin();
		await page.route("**/api/admin/reports**", async (route) => {
			const url = new URL(route.request().url());
			const typeFilter = url.searchParams.get("type") as "thread" | "post" | "user" | null;
			const filtered = typeFilter
				? REPORT_FIXTURE.filter((r) => r.type === typeFilter)
				: REPORT_FIXTURE;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: filtered,
					meta: {
						page: 1,
						pages: 1,
						total: filtered.length,
						limit: 20,
					},
				}),
			});
		});
	});

	// Same reasoning as the Operation Logs afterEach: drop the route so
	// later admin CRUD scenarios (and the sidebar badge probe) see the
	// real /api/admin/reports** instead of the in-memory fixture.
	test.afterEach(async ({ page }) => {
		await page.unroute("**/api/admin/reports**");
	});

	test("Given the reports page, Then per-type rows render correct target links, and When I filter type=用户, Then only the user row remains", async ({
		page,
	}) => {
		// Merges legacy RP-01 (list renders + per-type target labels/links) +
		// RP-02 (type filter narrows visible rows). Both load /admin/reports
		// with the same mock, both observe the same initial 3 rows, and the
		// filter is the natural next assertion after "list renders".
		await page.goto("/admin/reports");

		// Then: heading + type filter chip
		await expect(page.getByRole("heading", { name: "举报管理" })).toBeVisible();
		await expect(page.locator("select").filter({ hasText: "回帖" })).toBeVisible();

		// Then: thread row → admin thread link to thread 11
		const threadLink = page.getByRole("link", { name: /测试主题标题/ });
		await expect(threadLink).toBeVisible();
		await expect(threadLink).toHaveAttribute("href", "/admin/threads/11");

		// Then: post row → admin thread link to threadId (33), NOT targetId
		const postLink = page.getByRole("link", { name: /回帖所在主题/ });
		await expect(postLink).toBeVisible();
		await expect(postLink).toHaveAttribute("href", "/admin/threads/33");

		// Then: user row → admin user link to user 44
		const userLink = page.getByRole("link", { name: /@bob/ });
		await expect(userLink).toBeVisible();
		await expect(userLink).toHaveAttribute("href", "/admin/users/44");

		// When: select type=用户 in the type filter dropdown
		const typeSelect = page.locator("select").filter({ hasText: "回帖" });
		await typeSelect.selectOption({ label: "用户" });

		// Then: only the user row remains
		await expect(page.getByRole("link", { name: /@bob/ })).toBeVisible();
		await expect(page.getByRole("link", { name: /测试主题标题/ })).toHaveCount(0);
		await expect(page.getByRole("link", { name: /回帖所在主题/ })).toHaveCount(0);
	});
});

// =============================================================================
// Feature: Admin Forums CRUD (1 legacy test → 1 scenario; no merge)
// =============================================================================

interface AdminForum {
	id: number;
	name: string;
}

interface ForumListResponse {
	data: AdminForum[];
}

test.describe("Feature: Admin Forums CRUD", () => {
	let createdForumId: number | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		if (createdForumId == null) return;
		const id = createdForumId;
		createdForumId = null;
		try {
			const res = await context.request.delete(`/api/admin/forums/${id}`, {
				headers: { Origin: baseURL ?? "http://localhost:7032" },
			});
			if (![200, 204, 404].includes(res.status())) {
				console.warn(`afterEach forum cleanup got status ${res.status()} for id=${id}`);
			}
		} catch (err) {
			console.warn(`afterEach forum cleanup threw for id=${id}:`, err);
		}
	});

	test("Given the 版块管理 page, When I create a top-level 版块, edit its name, and delete it, Then each step round-trips through the admin proxy and the row appears/updates/disappears", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Legacy FO-01 — single closed-loop CRUD smoke kept 1:1 because the
		// happy path proves dialog open / form submit / CSRF gate / Worker
		// mutation / page refetch all in one navigation budget. Splitting
		// into create/edit/delete scenarios would force `.serial` state sharing
		// (createdForumId) without surfacing any new branch.
		await loginAsAdmin();
		await page.goto("/admin/forums");

		await expect(page.getByRole("heading", { name: "版块管理" })).toBeVisible();
		await expect(page.getByText("加载中...")).toBeHidden();

		// ── CREATE ─────────────────────────────────────────────────────
		const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const initialName = `L3测试版块_${uniqueSuffix}`;

		await page.getByRole("button", { name: "创建版块" }).first().click();

		const createDialog = page.getByRole("dialog", { name: "创建版块" });
		await expect(createDialog).toBeVisible();
		await createDialog.getByLabel("名称").fill(initialName);
		await createDialog.getByRole("button", { name: "创建版块" }).click();

		await expect(createDialog).toBeHidden();
		await expect(page.getByText(initialName, { exact: true })).toBeVisible();

		// Resolve forum id for afterEach safety net.
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
	});
});

// =============================================================================
// Feature: Admin Threads / Posts CRUD (1 legacy test → 1 scenario; no merge)
// =============================================================================

const SEED_THREAD_ID = 662174;
// Post 700001 is position #2 in thread 662174 — the first reply, always
// visible on detail page 1 (default limit=20).
const SEED_REPLY_POST_ID = 700001;

interface ThreadResponse {
	data: { id: number; subject: string };
}

interface PostResponse {
	data: { id: number; content: string };
}

test.describe("Feature: Admin Threads & Posts CRUD", () => {
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

	test("Given the admin threads list, When I open the seed thread detail, edit its subject and a non-first post, Then mutations land and the first-post 删除 menuitem is disabled with 无法删除楼主帖", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		// Legacy TH-01 — single closed-loop CRUD smoke kept 1:1. The flow
		// proves list→detail navigation, thread PATCH, post PATCH, and the
		// UI safety guard against CANNOT_DELETE_FIRST_POST in one navigation
		// budget; splitting would require .serial sharing of snapshots and
		// add no new branch coverage.
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		// Snapshot real current values up-front for afterEach restore.
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
		await page.getByRole("link", { name: originalSubject }).click();
		await expect(page).toHaveURL(new RegExp(`/admin/threads/${SEED_THREAD_ID}(\\?|$)`));
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

		// ── EDIT NON-FIRST POST (position #2 / post 700001) ────────────
		const contentSuffix = `\n\n[edited by L3 ${Date.now()}]`;
		const newContent = `${originalPostContent}${contentSuffix}`;
		await page.getByRole("button", { name: "打开第 2 楼操作菜单" }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();
		const postDialog = page.getByRole("dialog", { name: "编辑帖子" });
		await expect(postDialog).toBeVisible();
		await postDialog.getByLabel("内容").fill(newContent);
		await postDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(postDialog).toBeHidden();
		await expect(page.getByText(`[edited by L3`, { exact: false })).toBeVisible();

		// ── FIRST-POST DELETE GUARD (position #1) ──────────────────────
		await page.getByRole("button", { name: "打开第 1 楼操作菜单" }).click();
		const guardItem = page.getByRole("menuitem", { name: "无法删除楼主帖" });
		await expect(guardItem).toBeVisible();
		await expect(guardItem).toBeDisabled();
	});
});
