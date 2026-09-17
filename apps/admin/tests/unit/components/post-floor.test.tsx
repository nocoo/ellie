// @vitest-environment happy-dom

import { renderContent } from "@ellie/shared/content";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostFloor } from "@/components/admin/post-floor";
import type { EnrichedPost } from "@/viewmodels/admin/thread-detail";

afterEach(cleanup);

describe("PostFloor", () => {
	it("uses forum rendering for rich content and keeps the original content for editing", async () => {
		const content =
			'<div class="quote"><blockquote>引用</blockquote></div><p><strong>正文</strong> :smile:</p>\n[align=center]居中[/align]<img src="/photo.jpg" onerror="alert(1)"><script>evil()</script>';
		const post = {
			id: 7,
			position: 2,
			isFirst: false,
			createdAt: 1_700_000_000,
			authorId: 1,
			authorName: "alice",
			author: null,
			content,
		} as EnrichedPost;
		const onEdit = vi.fn();
		const { container } = render(<PostFloor post={post} onEdit={onEdit} onDelete={vi.fn()} />);
		const body = container.querySelector(".forum-content");
		expect(body?.querySelector("strong")?.textContent).toBe("正文");
		expect(body?.querySelector(".quote blockquote")?.textContent).toBe("引用");
		expect(body?.querySelector("img.smiley")?.getAttribute("src")).toContain("/smiley/");
		expect(body?.querySelector("script, [onerror]")).toBeNull();
		const expected = document.createElement("div");
		expected.innerHTML = renderContent(content);
		expect(body?.innerHTML).toBe(expected.innerHTML);

		fireEvent.keyDown(screen.getByRole("button", { name: "打开第 2 楼操作菜单" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "编辑" }));
		expect(onEdit).toHaveBeenCalledWith(post);
		expect(post.content).toBe(content);
	});
});
