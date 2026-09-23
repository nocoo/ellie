import { expect, test } from "./fixtures";

test.beforeEach(async ({ loginAs }) => {
	await loginAs("e2etest");
});

test("private messages support keyboard recipient selection, multiline drafts, failure retry and deletion", async ({
	page,
}) => {
	await page.goto("/messages");
	await page.getByRole("button", { name: "写站内信", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "写站内信", exact: true });
	let searches = 0;
	await page.route("**/api/v1/users/search?**", async (route) => {
		if (++searches > 1) return route.continue();
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Search unavailable" } },
		});
	});
	const recipient = page.getByRole("combobox", { name: "收信人", exact: true });
	await recipient.fill("e2eprofile");
	await page.getByRole("button", { name: "重试搜索" }).click();
	await expect(page.getByRole("option", { name: "e2eprofile", exact: true })).toBeVisible();
	await recipient.press("ArrowDown");
	await recipient.press("Enter");
	await expect(dialog.getByRole("button", { name: "清除收信人" })).toBeVisible();
	const subject = `Message interaction ${Date.now()}`;
	await dialog.getByRole("textbox", { name: "主题 (可选)", exact: true }).fill(subject);
	const content = dialog.getByRole("textbox", { name: "内容", exact: true });
	await content.fill("A message with two lines.");
	await content.press("Enter");
	await page.keyboard.type("The second line stays intact.");
	const original = await content.inputValue();
	expect(original).toContain("\n");
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const submissions: { content: string }[] = [];
	await page.route("**/api/v1/messages", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		submissions.push(route.request().postDataJSON());
		if (submissions.length > 1) return route.continue();
		await pending;
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Try sending again" } },
		});
	});
	await content.press("Control+Enter");
	await expect.poll(() => submissions.length).toBe(1);
	await expect(dialog.getByRole("button", { name: "发送中...", exact: true })).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	release();
	await expect(page.getByRole("alert", { name: "发送失败", exact: true })).toBeVisible();
	await expect(content).toHaveValue(original);
	expect(submissions[0].content).toBe(original);
	await dialog.getByRole("button", { name: "发送", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("alert", { name: "站内信已发送", exact: true })).toBeVisible();
	await page.goto("/messages?box=outbox");
	await page.getByText(subject, { exact: true }).click();
	await expect(page).toHaveURL(/\/messages\/\d+$/);
	await expect(page.getByText("The second line stays intact.", { exact: false })).toBeVisible();
	await page.getByRole("button", { name: "删除站内信", exact: true }).click();
	await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
	await expect(page).toHaveURL(/\/messages$/);
	await expect(page.getByRole("alert", { name: "站内信已删除", exact: true })).toBeVisible();
});

test("comments keep line breaks and input after failure, then show the confirmed write", async ({
	page,
}) => {
	await page.goto("/threads/662174");
	const post = page.locator("#post-662174");
	await post.getByRole("button", { name: "点评", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "发表点评", exact: true });
	const content = dialog.getByRole("textbox", { name: "点评内容", exact: true });
	await content.fill(`A helpful comment ${Date.now()}`);
	await content.press("Enter");
	await page.keyboard.type("With another line.");
	const original = await content.inputValue();
	const submissions: { content: string }[] = [];
	await page.route("**/api/v1/post-comments", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		submissions.push(route.request().postDataJSON());
		if (submissions.length > 1) return route.continue();
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Try commenting again" } },
		});
	});
	await content.press("Control+Enter");
	await expect(page.getByRole("alert", { name: "点评发送失败", exact: true })).toBeVisible();
	await expect(content).toHaveValue(original);
	expect(submissions[0].content).toBe(original);
	await dialog.getByRole("button", { name: "发送", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("alert", { name: "点评已发送", exact: true })).toBeVisible();
	await expect(post).toContainText("With another line.");
});

test("rating controls retain input on failure and honor server-granted revocation", async ({
	page,
}) => {
	await page.goto("/threads/662174");
	const post = page.locator("#post-662174");
	await post.getByRole("button", { name: "同钱", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "评分", exact: true });
	await dialog.getByRole("button", { name: "+1", exact: true }).click();
	const reason = dialog.getByRole("textbox", { name: "理由", exact: true });
	await reason.fill("A thoughtful contribution.");
	await reason.press("Enter");
	await page.keyboard.type("Thank you for sharing.");
	const original = await reason.inputValue();
	const aggregate = {
		total: 1,
		credits: { count: 0, sum: 0 },
		coins: { count: 1, sum: 1 },
	};
	const rating = {
		id: 98765,
		postId: 662174,
		threadId: 662174,
		raterId: 100,
		raterName: "e2etest",
		dimension: "coins",
		score: 1,
		reason: original,
		createdAt: Math.floor(Date.now() / 1000),
		revokedAt: 0,
		canRevoke: true,
	};
	// The Worker grants revocation only to staff; this scenario exercises that UI response.
	await page.route("**/api/v1/posts/662174/ratings", (route) =>
		route.fulfill({ json: { data: { items: [rating], aggregate } } }),
	);
	let submissions = 0;
	await page.route("**/api/v1/posts/662174/rate", async (route) => {
		if (++submissions > 1) return route.fulfill({ json: { data: { rating, aggregate } } });
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Try rating again" } },
		});
	});
	await reason.press("Control+Enter");
	await expect(page.getByRole("alert", { name: "评分提交失败", exact: true })).toBeVisible();
	await expect(reason).toHaveValue(original);
	await expect(dialog.getByRole("spinbutton", { name: "分值", exact: true })).toHaveValue("1");
	await dialog.getByRole("button", { name: "提交评分", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("alert", { name: "评分提交成功", exact: true })).toBeVisible();
	await post.getByRole("button", { name: "展开", exact: true }).click();
	const revoke = page.getByRole("button", { name: "撤销", exact: true });
	await expect(revoke).toBeVisible();
	let revocations = 0;
	await page.route("**/api/v1/posts/662174/ratings/*/revoke", async (route) => {
		if (++revocations > 1) return route.fulfill({ json: { data: {} } });
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Try revoking again" } },
		});
	});
	await revoke.click();
	await expect(page.getByRole("alert", { name: "撤销失败", exact: true })).toBeVisible();
	await expect(revoke).toBeEnabled();
	await revoke.click();
	await expect(page.getByRole("alert", { name: "评分已撤销", exact: true })).toBeVisible();
});

test("quoted replies preview the actual quote, restore failed drafts and keep reporting gated", async ({
	page,
}) => {
	await page.goto("/threads/662174");
	const post = page.locator("#post-662174");
	await post.getByRole("button", { name: "回复", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "回复主题", exact: true });
	const editor = dialog.getByRole("textbox", { name: "正文", exact: true });
	await editor.fill("A reply with a clear quoted context.");
	const before = await editor.innerHTML();
	await dialog.getByRole("tab", { name: "预览", exact: true }).click();
	const preview = dialog.getByRole("tabpanel", { name: "预览", exact: true });
	await expect(preview.locator(".quote")).toContainText("e2eprofile");
	await expect(preview.locator(".quote")).toContainText("L3 navigation thread first post");
	const submissions: { content: string }[] = [];
	await page.route("**/api/v1/posts", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		submissions.push(route.request().postDataJSON());
		await route.fulfill({
			status: 503,
			json: { error: { code: "UNAVAILABLE", message: "Try replying again" } },
		});
	});
	await preview.press("Control+Enter");
	await expect(page.getByRole("alert", { name: "回复失败", exact: true })).toBeVisible();
	expect(submissions).toHaveLength(1);
	expect(submissions[0].content).toContain('<div class="quote">');
	expect(submissions[0].content).toContain(before);
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await post.getByRole("button", { name: "回复", exact: true }).click();
	await expect(editor).toHaveText("A reply with a clear quoted context.");
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await post.getByRole("button", { name: "举报", exact: true }).click();
	const report = page.getByRole("dialog", { name: "举报回帖", exact: true });
	await expect(report).toContainText("人机验证");
	await expect(report.getByRole("button", { name: "提交举报", exact: true })).toBeDisabled();
	await report.getByRole("button", { name: "取消", exact: true }).click();
});
