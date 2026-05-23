// @vitest-environment happy-dom
// Tests for PostContent top meta bar mobile-hidden contract
// (reviewer freeze msg=5a91dfd3). On phones PostCard renders a
// compact header (avatar + author + time + floor) and the
// PostContent meta bar duplicates that information; this gate
// pins the `hidden md:flex` toggle so the duplicate never reappears.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/forum/post-author-status-icon", () => ({
	PostAuthorStatusIcon: () => createElement("span", { "data-testid": "post-author-status" }),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, ...rest }: any) => createElement("span", rest, children),
}));

vi.mock("@/lib/cdn", () => ({
	getAttachmentThumbUrl: (p: string) => `/thumb/${p}`,
	getAttachmentUrl: (p: string) => `/attach/${p}`,
	getStaticImageUrl: (n: string) => `/static/${n}`,
}));

vi.mock("@/viewmodels/forum/thread-detail", () => ({
	floorLabel: (pos: number, isFirst: boolean) => (isFirst ? "楼主" : `${pos}楼`),
	formatDateTime: () => "2026-01-01 12:00",
	formatFileSize: (n: number) => `${n}B`,
}));

import { PostContent } from "@/components/forum/post-content";

function makePost(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		threadId: 1,
		authorId: 1,
		position: 1,
		createdAt: 1700000000,
		content: "<p>body</p>",
		attachments: [],
		comments: undefined,
		canEdit: false,
		canDelete: false,
		author: null,
		...overrides,
	} as any;
}

afterEach(() => {
	cleanup();
});

describe("PostContent — top meta bar mobile-hidden contract", () => {
	it("meta bar wrapper carries `hidden md:flex` so it disappears on phones", () => {
		render(
			createElement(PostContent, {
				post: makePost(),
				isFirst: true,
			}),
		);
		const bar = screen.getByTestId("post-content-meta-bar");
		expect(bar.className).toContain("hidden");
		expect(bar.className).toContain("md:flex");
	});

	it("desktop still renders the 发表于 + floor pair inside the meta bar", () => {
		render(
			createElement(PostContent, {
				post: makePost({ position: 3 }),
				isFirst: false,
			}),
		);
		const bar = screen.getByTestId("post-content-meta-bar");
		// "发表于" + formatted date and the floor label both live inside the
		// meta bar; both must still be in the DOM (visibility is purely CSS).
		expect(bar.textContent).toContain("发表于");
		expect(bar.textContent).toContain("2026-01-01 12:00");
		const floor = screen.getByTestId("post-content-floor");
		expect(floor.textContent).toContain("3楼");
	});
});
