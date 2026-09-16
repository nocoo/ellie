import { expect, test } from "../../admin/fixtures/admin-base";

test.describe("Admin Basalt integration", () => {
	test("keeps the brand stationary and navigation links usable when collapsing", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await loginAsAdmin();
		await page.goto("/admin");
		const logo = page.getByRole("complementary").getByRole("img", { name: "Ellie" });
		const before = await logo.boundingBox();
		await page.getByRole("button", { name: "收起侧栏" }).click();
		await expect(page.getByRole("complementary")).toHaveCSS("width", "68px");
		const after = await logo.boundingBox();
		expect(after?.x).toBe(before?.x);
		expect(after?.y).toBe(before?.y);
		const users = page
			.getByRole("navigation", { name: "管理后台", exact: true })
			.getByRole("link", { name: "用户", exact: true });
		await expect(users).toHaveAttribute("href", "/admin/users");
		await users.click();
		await expect(page).toHaveURL(/\/admin\/users$/);
		await expect(users).toHaveAttribute("aria-current", "page");
		await page.getByRole("button", { name: "展开侧栏" }).click();
		await expect(page.getByRole("complementary")).toHaveCSS("width", "260px");
		expect((await logo.boundingBox())?.x).toBe(before?.x);
	});

	test("traps mobile navigation focus and restores the trigger on dismissal", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin();
		await page.goto("/admin");
		const trigger = page.getByRole("button", { name: "打开导航" });
		await expect(page.getByRole("complementary")).toHaveCount(0);
		await trigger.click();
		const drawer = page.getByRole("dialog", { name: "管理后台导航" });
		await expect(drawer).toBeVisible();
		await page.keyboard.press("Shift+Tab");
		expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await drawer.getByRole("link", { name: "用户", exact: true }).click();
		await expect(page).toHaveURL(/\/admin\/users$/);
		await expect(drawer).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			375,
		);
	});

	test("preserves the Google server-action form, login errors and theme preference", async ({
		page,
	}) => {
		await page.goto("/login?error=AccessDenied");
		await expect(page.getByRole("alert")).toHaveText("您的账号无权访问此应用。");
		const signIn = page.getByRole("button", { name: "使用 Google 登录" });
		await expect(signIn).toHaveAttribute("type", "submit");
		await expect(signIn).toBeEnabled();
		await expect(signIn.locator("..")).toHaveAttribute("method", "POST");
		await page.evaluate(() => localStorage.setItem("theme", "light"));
		await page.reload();
		await page.getByRole("button", { name: "切换主题" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
		await page.getByRole("button", { name: "切换主题" }).click();
		expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("system");
	});
});
