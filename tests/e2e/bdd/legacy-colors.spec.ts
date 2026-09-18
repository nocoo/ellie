import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { renderContent } from "../../../packages/shared/src/content";

const contentCss = readFileSync(
	new URL("../../../packages/shared/src/content.css", import.meta.url),
	"utf8",
);
const themeCss = readFileSync(
	new URL("../../../apps/web/src/app/tailwind.css", import.meta.url),
	"utf8",
);
const variables = [
	themeCss.match(/^:root\s*\{[\s\S]*?^\}/m)?.[0],
	themeCss.match(/^\.dark\s*\{[\s\S]*?^\}/m)?.[0],
].join("\n");

for (const width of [375, 1280]) {
	test(`legacy colors follow the dark theme without changing layout at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.route("**/*", (route) => route.abort());
		const raw =
			'<div style="text-align:center"><font id="legacy-text" color="#000033" size="5"><b>粗体</b> <i>斜体</i> <u>下划线</u></font><br><a id="body-link" href="https://example.invalid"><font id="link-text" color="#000033">链接</font></a><ul><li>保留列表</li></ul><table id="legacy-table" bgcolor="#ffffff"><tr><td colspan="2"><font color="#000033">表格</font></td></tr></table></div>';
		await page.setContent(`<!doctype html><html><head><style>
			${variables}
			${contentCss}
			body { color: hsl(var(--foreground)); background: hsl(var(--background)); font: 16px sans-serif; }
			.forum-content { max-width: 100%; }
			.forum-content a { color: hsl(var(--primary)); }
		</style></head><body>
			<a id="title" class="forum-thread-title" style="color:#000033;font-weight:bold;font-style:italic;text-decoration:underline" href="#">旧标题</a>
			<article class="forum-content prose">${renderContent(raw)}</article>
			<div id="editor"><font color="#000033">编辑内容不受展示规则影响</font></div>
		</body></html>`);
		const geometry = () =>
			page.locator("body *").evaluateAll((nodes) =>
				nodes.map((node) => {
					const rect = node.getBoundingClientRect();
					const style = getComputedStyle(node);
					return [
						node.tagName,
						rect.x,
						rect.y,
						rect.width,
						rect.height,
						style.fontSize,
						style.fontWeight,
						style.fontStyle,
						style.textDecorationLine,
						style.textAlign,
					];
				}),
			);
		const lightLayout = await geometry();
		const markup = await page.locator("body").innerHTML();
		await expect(page.locator("#legacy-text")).toHaveCSS("color", "rgb(0, 0, 51)");
		await expect(page.locator("#legacy-table")).toHaveCSS("background-color", "rgb(255, 255, 255)");

		await page.evaluate(() => document.documentElement.classList.add("dark"));
		const foreground = await page.locator("body").evaluate((node) => getComputedStyle(node).color);
		await expect(page.locator("#legacy-text")).toHaveCSS("color", foreground);
		await expect(page.locator("#title")).toHaveCSS("color", foreground);
		await expect(page.locator("#legacy-table")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		const linkColor = await page
			.locator("#body-link")
			.evaluate((node) => getComputedStyle(node).color);
		await expect(page.locator("#link-text")).toHaveCSS("color", linkColor);
		await expect(page.locator("#editor font")).toHaveCSS("color", "rgb(0, 0, 51)");
		expect(await geometry()).toEqual(lightLayout);
		expect(await page.locator("body").innerHTML()).toBe(markup);
		await page.locator("#title").hover();
		await expect(page.locator("#title")).toHaveCSS("color", linkColor);

		await page.evaluate(() => document.documentElement.classList.remove("dark"));
		await expect(page.locator("#legacy-text")).toHaveCSS("color", "rgb(0, 0, 51)");
		await expect(page.locator("#title")).toHaveCSS("color", "rgb(0, 0, 51)");
		await expect(page.locator("#legacy-table")).toHaveCSS("background-color", "rgb(255, 255, 255)");
		expect(await geometry()).toEqual(lightLayout);
	});
}
