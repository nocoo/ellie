import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPostColumns } from "@/components/admin/columns/post-columns";
import type { Post } from "@/viewmodels/admin/posts";

describe("buildPostColumns", () => {
	it("shows decoded reply text without HTML or losing ordinary bracketed text", () => {
		const post = {
			id: 7,
			position: 2,
			isFirst: false,
			content: "<p>正文 &amp; <b>加粗</b> [备注]</p><script>evil()</script>",
		} as Post;
		const cell = buildPostColumns().find((column) => column.key === "content");
		const html = renderToStaticMarkup(cell?.cell(post));
		expect(html).toContain("正文 &amp; 加粗 [备注]");
		expect(html).not.toMatch(/&lt;|<b>|evil\(\)/);
	});

	it("truncates after cleaning, so long HTML attributes do not consume the excerpt", () => {
		const post = {
			id: 7,
			position: 2,
			isFirst: false,
			content: `<a href="https://example.com/${"x".repeat(200)}">可见正文</a>`,
		} as Post;
		const cell = buildPostColumns().find((column) => column.key === "content");
		expect(renderToStaticMarkup(cell?.cell(post))).toContain("可见正文");
	});

	it("default variant emits the 4 recent-view columns", () => {
		const cols = buildPostColumns();
		expect(cols.map((c) => c.key)).toEqual(["content", "author", "thread", "createdAt"]);
	});

	it("does not emit an actions column", () => {
		// Recent's PostsTab today splices its own Trash2 actions column.
		const cols = buildPostColumns();
		expect(cols.map((c) => c.key)).not.toContain("actions");
	});
});
