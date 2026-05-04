// tests/e2e/admin/admin-users.spec.ts — A3 admin users single-op smoke
//
// Single-record idempotent loop on /admin/users for seed user id=3
// (testuser, role=会员):
//   1. Edit profile — bump credits by +1 via the edit dialog.
//   2. Ban — open menu → 封禁 → confirm → assert 已封禁 badge + menu
//      surfaces 解除封禁 (and not 封禁).
//   3. Unban — open menu → 解除封禁 (no confirm dialog; handleUnban is a
//      direct PATCH { status: 0 }) → assert badge back to 正常.
//
// Cleanup
//   - afterEach PATCHes the snapshot back via /api/admin/users/3 with
//     all fields (username/email/avatar/credits/status/role) so even a
//     mid-test crash leaves the row identical to start. PATCH is
//     idempotent: re-applying snapshot is a no-op when nothing drifted.
//
// Why testuser (id=3)
//   - Has zero relevant content (only owns thread 1 in forum 1, which
//     this spec doesn't touch).
//   - Not e2etest (forum L3 login user) and not e2eprofile (owns the
//     L3 navigation thread).
//   - role=会员 — we don't change role at all to avoid the worker's
//     missing self-role guard.
//
// Selectors
//   - Users action trigger now has aria-label "打开用户「{username}」操作菜单"
//     so the per-row menu is reachable by accessible name across pages.
//   - Filter the list to the snapshot username via UI search to avoid
//     pagination/same-name interference; row will then be the only one
//     in the table.
//   - The 当前积分 Label includes a sibling span with the formatted value
//     (e.g. "+100"), so getByLabel("当前积分") matches "当前积分+N" rather
//     than the input. Use dialog.locator('#edit-credits') instead.
//   - 解除封禁 has NO confirm dialog (verified in use-users-admin.ts);
//     do not wait on a dialog after clicking it.
//
// Out of scope (per @zheng-li single-op edge + reviewer guidance)
//   - 封禁并删除内容 (cascade-delete content)
//   - 彻底清除 / nuke (requires typed-username confirm; zeros credits)
//   - role changes (no self-role guard in worker)
//   - any batch endpoint
//   - users 100 (e2etest) and 64495 (e2eprofile)

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

	test("edit credits → ban → unban", async ({ context, page, loginAsAdmin, baseURL }) => {
		const origin = baseURL ?? "http://localhost:7032";

		// Mint admin session BEFORE any admin proxy GET (proxy gates GET too).
		await loginAsAdmin();

		// Snapshot every safe-to-restore field so afterEach can roll back
		// regardless of which step in the test body failed.
		{
			const res = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin },
			});
			expect(res.ok(), "GET /api/admin/users/:id should succeed").toBeTruthy();
			snapshot = ((await res.json()) as UserResponse).data;
		}
		const snap = snapshot;
		expect(snap, "user snapshot must be present").toBeTruthy();
		if (!snap) throw new Error("unreachable: snapshot asserted truthy");
		const initialUsername = snap.username;
		const initialCredits = snap.credits;
		expect(typeof initialUsername === "string" && initialUsername.length > 0).toBeTruthy();

		// ── NAVIGATE + FILTER TO TARGET USER ───────────────────────────
		// Use the URL-driven initial search to land directly on the
		// filtered row — avoids pagination drift between test runs.
		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
		// The cell containing the username is unique under the search filter.
		await expect(page.getByText(initialUsername, { exact: true }).first()).toBeVisible();

		// ── EDIT PROFILE: bump credits by +1 ───────────────────────────
		const triggerName = `打开用户「${initialUsername}」操作菜单`;
		await page.getByRole("button", { name: triggerName }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();
		// 当前积分 Label has a sibling formatted-value span; getByLabel would
		// match the wrong element. Locate the input by its id directly.
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
			expect(after.username).toBe(initialUsername); // unchanged
		}

		// ── BAN ────────────────────────────────────────────────────────
		await page.getByRole("button", { name: triggerName }).click();
		await page.getByRole("menuitem", { name: "封禁", exact: true }).click();

		const banDialog = page.getByRole("dialog", { name: "封禁用户" });
		await expect(banDialog).toBeVisible();
		await banDialog.getByRole("button", { name: "确认" }).click();
		await expect(banDialog).toBeHidden();

		// Status badge in the row flips to 已封禁.
		await expect(page.getByText("已封禁", { exact: true })).toBeVisible();

		// Reopen the menu — 解除封禁 should now appear; plain 封禁 should not.
		await page.getByRole("button", { name: triggerName }).click();
		await expect(page.getByRole("menuitem", { name: "解除封禁" })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "封禁", exact: true })).toHaveCount(0);

		// ── UNBAN (no confirm dialog) ──────────────────────────────────
		// handleUnban directly PATCHes { status: 0 } — there is no
		// AdminConfirmDialog open after clicking 解除封禁.
		await page.getByRole("menuitem", { name: "解除封禁" }).click();

		// Status badge returns to 正常.
		await expect(page.getByText("正常", { exact: true })).toBeVisible();
		// And menu items revert: 封禁 visible, 解除封禁 gone.
		await page.getByRole("button", { name: triggerName }).click();
		await expect(page.getByRole("menuitem", { name: "封禁", exact: true })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "解除封禁" })).toHaveCount(0);
	});
});
