import { expect, test } from "../../admin/fixtures/admin-base";

test("keeps all user editor sections and its footer reachable on mobile, and discards cancelled changes", async ({
	page,
	loginAsAdmin,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await loginAsAdmin();
	await page.goto("/admin/users/3");
	const trigger = page.getByRole("button", { name: "编辑资料" });
	await trigger.click();
	const editor = page.getByRole("dialog", { name: "编辑用户", exact: true });
	const navigation = editor.getByRole("navigation", { name: "用户资料分区" });
	const save = editor.getByRole("button", { name: "保存更改", exact: true });
	await expect(navigation.getByRole("button")).toHaveCount(7);
	const originalUsername = await editor.getByLabel("用户名", { exact: true }).inputValue();
	await editor.getByLabel("用户名", { exact: true }).fill("cancelled-local-edit");
	await editor.evaluate(async (element) => {
		await Promise.all(element.getAnimations().map((animation) => animation.finished));
	});
	const before = await save.boundingBox();
	for (const button of await navigation.getByRole("button").all()) {
		await button.click();
		const targetId = await button.getAttribute("aria-controls");
		if (!targetId) throw new Error("Editor section needs an accessible target");
		await expect(editor.locator(`#${targetId}`).getByRole("heading")).toBeInViewport();
		await expect(save).toBeInViewport();
		const after = await save.boundingBox();
		expect(after?.y).toBe(before?.y);
	}
	await expect(editor.getByLabel("最后登录 IP", { exact: true })).toBeInViewport();
	await editor.getByRole("button", { name: "取消", exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(editor.getByLabel("用户名", { exact: true })).toHaveValue(originalUsername);
	await page.keyboard.press("Escape");
});

test("lets settings be edited again after resetting the same unsaved value", async ({
	page,
	loginAsAdmin,
}) => {
	await loginAsAdmin();
	await page.goto("/admin/settings/general");
	const input = page.locator('input[id="general.site.name"]');
	const initial = await input.inputValue();
	const save = page.getByRole("button", { name: "保存", exact: true }).first();
	const reset = page.getByRole("button", { name: "重置", exact: true }).first();
	await expect(save).toBeDisabled();
	await input.fill(`${initial}-local-preview`);
	await expect(save).toBeEnabled();
	await reset.click();
	await expect(input).toHaveValue(initial);
	await expect(save).toBeDisabled();
	await input.fill(`${initial}-local-preview`);
	await expect(save).toBeEnabled();
	await expect(reset).toBeEnabled();
	await reset.click();
	await expect(save).toBeDisabled();
});

test("requires typed confirmation before sending an attachment batch deletion", async ({
	page,
	loginAsAdmin,
}) => {
	let deletions = 0;
	await page.route("**/api/admin/attachments**", (route) => {
		if (route.request().method() === "POST") {
			deletions++;
			return route.fulfill({ json: { data: { deleted: 1 } } });
		}
		return route.fulfill({
			json: {
				data: [
					{
						id: 1,
						postId: 1,
						filename: "local-fixture.pdf",
						filePath: "/local-fixture.pdf",
						fileSize: 1024,
						isImage: false,
						hasThumb: false,
						downloads: 0,
						authorId: 3,
						threadId: 662174,
						createdAt: 1_700_000_000,
					},
				],
				meta: { page: 1, pages: 1, limit: 100, total: 1 },
			},
		});
	});
	await loginAsAdmin();
	await page.goto("/admin/attachments");
	await page.getByRole("checkbox", { name: "选择附件 local-fixture.pdf", exact: true }).click();
	await page.getByRole("button", { name: "批量删除", exact: true }).click();
	const confirmation = page.getByRole("dialog", { name: "批量删除附件", exact: true });
	const confirm = confirmation.getByRole("button", { name: "确认", exact: true });
	await expect(confirm).toBeDisabled();
	expect(deletions).toBe(0);
	await confirmation.getByRole("textbox", { name: "确认文本" }).fill("wrong");
	await expect(confirm).toBeDisabled();
	await confirmation.getByRole("textbox", { name: "确认文本" }).fill("ok");
	await expect(confirm).toBeEnabled();
	expect(deletions).toBe(0);
	await confirm.click();
	await expect(confirmation).toBeHidden();
	expect(deletions).toBe(1);
});
