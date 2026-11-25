import { expect, test } from "../../admin/fixtures/admin-base";

const SEED_USER_ID = 3;

interface AdminUser {
	id: number;
	username: string;
	email: string;
	credits: number;
	status: number;
	role: number;
	regIp: string;
	lastIp: string;
}

interface UserResponse {
	data: AdminUser;
}

interface AdminForum {
	id: number;
	name: string;
}

interface ForumListResponse {
	data: AdminForum[];
}

test.describe("Feature: Admin Users CRUD", () => {
	let snapshot: AdminUser | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		if (!snapshot) return;
		const snap = snapshot;
		snapshot = null;
		const origin = baseURL ?? "http://localhost:7032";
		try {
			await context.request.patch(`/api/admin/users/${SEED_USER_ID}`, {
				headers: { Origin: origin, "Content-Type": "application/json" },
				data: {
					username: snap.username,
					email: snap.email,
					credits: snap.credits,
					status: snap.status,
					role: snap.role,
					regIp: snap.regIp,
					lastIp: snap.lastIp,
				},
			});
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
		const origin = baseURL ?? "http://localhost:7032";
		await loginAsAdmin();

		const getRes = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
			headers: { Origin: origin },
		});
		expect(getRes.ok()).toBeTruthy();
		snapshot = ((await getRes.json()) as UserResponse).data;
		const snap = snapshot;
		const initialUsername = snap.username;
		const newCredits = snap.credits + 1;

		await page.goto(`/admin/users?search=${encodeURIComponent(initialUsername)}`);
		await expect(
			page.locator("main [data-basalt-surface-root]").getByRole("heading", { name: "用户" }),
		).toBeVisible();
		await page.getByRole("button", { name: `编辑用户「${initialUsername}」` }).click();

		const editDialog = page.getByRole("dialog", { name: "编辑用户" });
		await expect(editDialog).toBeVisible();
		await editDialog.locator("#edit-credits").fill(String(newCredits));
		await editDialog.getByRole("button", { name: "保存更改" }).click();
		await expect(editDialog).toBeHidden();

		const afterRes = await context.request.get(`/api/admin/users/${SEED_USER_ID}`, {
			headers: { Origin: origin },
		});
		expect(afterRes.ok()).toBeTruthy();
		const after = ((await afterRes.json()) as UserResponse).data;
		expect(after.credits).toBe(newCredits);
	});
});

test.describe("Feature: Admin Forums CRUD", () => {
	let createdForumId: number | null = null;

	test.afterEach(async ({ context, baseURL }) => {
		if (createdForumId == null) return;
		const id = createdForumId;
		createdForumId = null;
		try {
			await context.request.delete(`/api/admin/forums/${id}`, {
				headers: { Origin: baseURL ?? "http://localhost:7032" },
			});
		} catch (err) {
			console.warn(`afterEach forum cleanup threw for id=${id}:`, err);
		}
	});

	test("Given the 版块管理 page, When I create a top-level 版块, edit its name, and delete it, Then each step round-trips through the admin proxy", async ({
		context,
		page,
		loginAsAdmin,
		baseURL,
	}) => {
		await loginAsAdmin();
		await page.goto("/admin/forums");

		await expect(
			page.locator("main [data-basalt-surface-root]").getByRole("heading", { name: "版块管理" }),
		).toBeVisible();
		await expect(page.getByText("加载中...")).toBeHidden();

		const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const initialName = `L3测试版块_${uniqueSuffix}`;

		await page.getByRole("button", { name: "创建版块" }).first().click();
		const createDialog = page.getByRole("dialog", { name: "创建版块" });
		await expect(createDialog).toBeVisible();
		await createDialog.getByLabel("名称").fill(initialName);
		await createDialog.getByRole("button", { name: "创建版块" }).click();
		await expect(createDialog).toBeHidden();
		await expect(page.getByText(initialName, { exact: true })).toBeVisible();

		const res = await context.request.get("/api/admin/forums", {
			headers: { Origin: baseURL ?? "http://localhost:7032" },
		});
		expect(res.ok()).toBeTruthy();
		const body = (await res.json()) as ForumListResponse;
		const created = body.data.find((f) => f.name === initialName);
		expect(created).toBeTruthy();
		createdForumId = created?.id ?? null;

		const editedName = `${initialName}_edited`;
		await page.getByRole("button", { name: `打开「${initialName}」操作菜单` }).click();
		await page.getByRole("menuitem", { name: "编辑" }).click();
		const editDialog = page.getByRole("dialog", { name: "编辑版块" });
		await expect(editDialog).toBeVisible();
		await editDialog.getByLabel("名称").fill(editedName);
		await editDialog.getByRole("button", { name: "保存" }).click();
		await expect(editDialog).toBeHidden();
		await expect(page.getByText(editedName, { exact: true })).toBeVisible();

		await page.getByRole("button", { name: `打开「${editedName}」操作菜单` }).click();
		await page.getByRole("menuitem", { name: "删除" }).click();
		const confirmDialog = page.getByRole("dialog", { name: "删除版块" });
		await expect(confirmDialog).toBeVisible();
		await confirmDialog.getByRole("button", { name: "确认" }).click();
		await expect(confirmDialog).toBeHidden();
		await expect(page.getByText(editedName, { exact: true })).toBeHidden();
	});
});
