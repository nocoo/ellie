import { expect, test } from "./fixtures";

for (const platform of ["Win32", "MacIntel"]) {
	test.describe(`Composer keyboard on ${platform}`, () => {
		test.beforeEach(async ({ page, loginAs }) => {
			await page.addInitScript((value) => {
				Object.defineProperty(navigator, "platform", { get: () => value });
			}, platform);
			await page.goto("/");
			await loginAs("e2etest");
			await page.goto("/forums/1/new-thread");
			await page
				.getByRole("textbox", { name: "主题标题", exact: true })
				.fill("Keyboard regression test");
		});

		test("Enter splits paragraphs; Ctrl+Enter preserves text and submits once", async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const editor = page.getByRole("textbox", { name: "正文", exact: true });
			await editor.fill("First paragraph");
			await editor.press("Enter");
			await page.keyboard.type("Second paragraph");
			await expect(editor.locator("p")).toHaveCount(2);
			await expect(editor.locator("p").nth(1)).toHaveText("Second paragraph");

			await editor.evaluate((element) => {
				const node = element.querySelector("p")?.firstChild;
				if (!node) throw new Error("Missing paragraph text");
				const range = document.createRange();
				range.setStart(node, 5);
				range.collapse(true);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
			});
			await expect(page.getByRole("textbox", { name: "主题标题", exact: true })).toHaveValue(
				"Keyboard regression test",
			);
			const before = await editor.innerHTML();
			const submitted: { content: string }[] = [];
			await page.route("**/api/v1/threads", async (route) => {
				if (route.request().method() !== "POST") return route.continue();
				submitted.push(route.request().postDataJSON());
				await route.fulfill({
					status: 500,
					json: { error: { code: "INTERNAL_ERROR", message: "Test submission failure" } },
				});
			});
			await editor.press("Control+Enter");
			await expect(page.getByRole("alert", { name: "发帖失败", exact: true })).toBeVisible();
			expect(submitted).toHaveLength(1);
			expect(submitted[0].content).toBe(before);
			expect(await editor.innerHTML()).toBe(before);
			expect(errors).toEqual([]);
		});

		test("IME confirmation cannot publish a thread", async ({ page }) => {
			const editor = page.getByRole("textbox", { name: "正文", exact: true });
			await editor.fill("中文输入法正在确认候选文字");
			let submissions = 0;
			await page.route("**/api/v1/threads", async (route) => {
				if (route.request().method() !== "POST") return route.continue();
				submissions++;
				await route.abort();
			});
			await editor.dispatchEvent("compositionstart");
			await editor.dispatchEvent("keydown", {
				key: "Enter",
				code: "Enter",
				keyCode: 229,
				ctrlKey: true,
				isComposing: true,
			});
			await editor.dispatchEvent("compositionend");
			await expect(editor).toHaveText("中文输入法正在确认候选文字");
			expect(submissions).toBe(0);
		});
	});
}

test.describe("Rich composition", () => {
	test.beforeEach(async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/forums/1/new-thread");
	});

	test("formatting survives preview, undo and redo", async ({ page }) => {
		const title = page.getByRole("textbox", { name: "主题标题", exact: true });
		const editor = page.getByRole("textbox", { name: "正文", exact: true });
		await title.fill("A professionally formatted post");
		await editor.fill("A clear heading");
		await page.getByRole("button", { name: "段落样式" }).click();
		await page.getByRole("menuitemradio", { name: "大标题" }).click();
		await expect(editor.locator("h2")).toHaveText("A clear heading");
		await page.getByRole("button", { name: "撤销", exact: true }).click();
		await expect(editor.locator("h2")).toHaveCount(0);
		await page.getByRole("button", { name: "重做", exact: true }).click();
		await expect(editor.locator("h2")).toHaveCount(1);
		const before = await editor.innerHTML();
		await page.getByRole("tab", { name: "预览", exact: true }).click();
		const preview = page.getByRole("tabpanel", { name: "预览", exact: true });
		await expect(preview.getByRole("heading", { name: "A clear heading" })).toBeVisible();
		await expect(
			preview.getByRole("heading", { name: "A professionally formatted post" }),
		).toBeVisible();
		await page.getByRole("tab", { name: "撰写", exact: true }).click();
		expect(await editor.innerHTML()).toBe(before);
	});

	test("links preserve selected text, reject unsafe URLs, and can be edited or removed", async ({
		page,
	}) => {
		const editor = page.getByRole("textbox", { name: "正文", exact: true });
		await editor.fill("Useful reference");
		await editor.press("ControlOrMeta+A");
		await page.getByRole("button", { name: "插入链接", exact: true }).click();
		const address = page.getByRole("textbox", { name: "链接地址", exact: true });
		await address.fill("javascript:alert(1)");
		await page.getByRole("button", { name: "确定", exact: true }).click();
		await expect(page.getByRole("alert").filter({ hasText: "不支持的链接地址" })).toBeVisible();
		await expect(editor.locator("a")).toHaveCount(0);
		await address.fill("example.com/reference");
		await page.getByRole("button", { name: "确定", exact: true }).click();
		await expect(editor.getByRole("link", { name: "Useful reference" })).toHaveAttribute(
			"href",
			"https://example.com/reference",
		);
		await page.getByRole("tab", { name: "预览", exact: true }).click();
		await expect(
			page.getByRole("tabpanel", { name: "预览", exact: true }).getByRole("link"),
		).toHaveAttribute("href", "https://example.com/reference");
		await page.getByRole("tab", { name: "撰写", exact: true }).click();
		await editor.click();
		await editor.press("ControlOrMeta+A");
		await page.getByRole("button", { name: "插入链接", exact: true }).click();
		await expect(address).toHaveValue("https://example.com/reference");
		await address.fill("https://example.com/updated");
		await page.getByRole("button", { name: "确定", exact: true }).click();
		await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/updated");
		await page.getByRole("button", { name: "插入链接", exact: true }).click();
		await page.getByRole("button", { name: "移除链接", exact: true }).click();
		await expect(editor.locator("a")).toHaveCount(0);
		await expect(editor).toHaveText("Useful reference");
	});

	test("uploaded images are served by the local API and displayed in the preview", async ({
		page,
	}) => {
		const editor = page.getByRole("textbox", { name: "正文", exact: true });
		await editor.fill("An image uploaded through the actual API.");
		await page.locator('input[type="file"]').setInputFiles({
			name: "local-review.png",
			mimeType: "image/png",
			buffer: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
				"base64",
			),
		});
		const image = editor.locator("img");
		await expect(image).toHaveAttribute("src", /^\/api\/post-image\/[a-f\d-]+\.png$/);
		await expect
			.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
			.toBe(1);
		const source = await image.getAttribute("src");
		await page.getByRole("tab", { name: "预览", exact: true }).click();
		const previewImage = page.getByRole("tabpanel", { name: "预览", exact: true }).locator("img");
		await expect(previewImage).toHaveAttribute("src", source ?? "");
		await expect
			.poll(() => previewImage.evaluate((element: HTMLImageElement) => element.naturalWidth))
			.toBe(1);
	});

	test("drafts survive reload, stay with their forum, and clear after publication", async ({
		page,
	}) => {
		const title = page.getByRole("textbox", { name: "主题标题", exact: true });
		const editor = page.getByRole("textbox", { name: "正文", exact: true });
		await title.fill("Keep this draft title");
		await editor.fill("Keep all of this draft content after reload.");
		await expect(page.getByRole("status")).toContainText("草稿已保存");
		await page.reload();
		await expect(title).toHaveValue("Keep this draft title");
		await expect(editor).toHaveText("Keep all of this draft content after reload.");
		await page.goto("/forums/2/new-thread");
		await expect(title).toHaveValue("");
		await expect(editor).toHaveText("");
		await page.goto("/forums/1/new-thread");
		await expect(title).toHaveValue("Keep this draft title");
		await expect(editor).toHaveText("Keep all of this draft content after reload.");
		await page.route("**/api/v1/threads", async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			await route.fulfill({ json: { data: { id: 1 } } });
		});
		await page.getByRole("button", { name: "发布主题", exact: true }).click();
		await expect(page).toHaveURL(/\/threads\/1$/);
		expect(
			await page.evaluate(() => sessionStorage.getItem("ellie:composer:100:thread:1")),
		).toBeNull();
	});

	test("pasted image upload blocks publishing and keeps its position while writing continues", async ({
		page,
	}) => {
		await page
			.getByRole("textbox", { name: "主题标题", exact: true })
			.fill("Image upload and typing");
		const editor = page.getByRole("textbox", { name: "正文", exact: true });
		await editor.fill("Before after");
		await editor.evaluate(
			(element) =>
				new Promise<void>((resolve) => {
					const text = element.querySelector("p")?.firstChild;
					if (!text) throw new Error("Missing paragraph text");
					// Wait for native selectionchange before synthesizing the clipboard event.
					document.addEventListener("selectionchange", () => resolve(), { once: true });
					const range = document.createRange();
					range.setStart(text, 7);
					range.collapse(true);
					window.getSelection()?.removeAllRanges();
					window.getSelection()?.addRange(range);
				}),
		);
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let uploads = 0;
		let submissions = 0;
		await page.route("**/api/v1/threads", async (route) => {
			submissions++;
			await route.abort();
		});
		await page.route("**/api/v1/upload", async (route) => {
			uploads++;
			await pending;
			await route.fulfill({
				json: {
					data: {
						url: new URL("/review-image.png", page.url()).href,
						size: 12,
						contentType: "image/png",
					},
				},
			});
		});
		await page.route("**/review-image.png", (route) =>
			route.fulfill({
				contentType: "image/png",
				body: Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
					"base64",
				),
			}),
		);
		await editor.evaluate((element) => {
			const clipboard = new DataTransfer();
			clipboard.items.add(new File(["test image"], "review.png", { type: "image/png" }));
			element.dispatchEvent(
				new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
			);
		});
		await expect.poll(() => uploads).toBe(1);
		await expect(page.getByRole("button", { name: "发布主题", exact: true })).toBeDisabled();
		await editor.press("Control+Enter");
		expect(submissions).toBe(0);
		for (let i = 0; i < 5; i++) await editor.press("ArrowRight");
		await page.keyboard.type(" continued");
		release();
		await expect(editor.locator("img")).toHaveCount(1);
		await expect(editor).toContainText("Before");
		await expect(editor).toContainText("after continued");
		const position = await editor.evaluate((element) =>
			Array.from(element.children).map((node) =>
				node.tagName === "IMG" ? "IMAGE" : node.textContent,
			),
		);
		expect(position).toEqual(["Before ", "IMAGE", "after continued"]);
		await expect(page.getByRole("button", { name: "发布主题", exact: true })).toBeEnabled();
	});

	test("mobile and reduced-motion composition remain usable", async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
		await page.getByRole("textbox", { name: "主题标题", exact: true }).fill("移动端编辑与预览");
		await page
			.getByRole("textbox", { name: "正文", exact: true })
			.fill("小屏幕也能从容写作，切换预览，检查格式后再发布。");
		await page.getByRole("tab", { name: "预览", exact: true }).click();
		await expect(page.getByRole("tabpanel", { name: "预览", exact: true })).toContainText(
			"检查格式后再发布",
		);
		const layout = await page.evaluate(() => ({
			viewport: document.documentElement.clientWidth,
			width: document.documentElement.scrollWidth,
			animation: Number.parseFloat(
				getComputedStyle(document.querySelector(".composer-preview") ?? document.body)
					.animationDuration,
			),
		}));
		expect(layout.width).toBeLessThanOrEqual(layout.viewport);
		expect(layout.animation).toBeLessThanOrEqual(0.001);
		const publish = page.getByRole("button", { name: "发布主题", exact: true });
		await publish.scrollIntoViewIfNeeded();
		await expect(publish).toBeInViewport();
		await page.screenshot({ path: testInfo.outputPath("composer-mobile.png"), fullPage: true });
	});
});
