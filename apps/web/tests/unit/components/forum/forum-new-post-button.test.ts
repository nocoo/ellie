// @vitest-environment happy-dom
// Tests for ForumNewPostButton mobile-hidden contract (reviewer freeze
// msg=5a91dfd3). Pinned via class tokens because happy-dom does not
// evaluate media queries. The PC behaviour (visible at ≥640px) is
// guaranteed by the `sm:inline-block` half of the same string.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
}));

vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: vi.fn(async () => false),
}));

// Stub the dialog out — it pulls in heavy editor deps unrelated to the
// button's responsive contract.
vi.mock("@/components/forum/new-thread-dialog", () => ({
	NewThreadDialog: () => null,
}));

import { ForumNewPostButton } from "@/components/forum/forum-new-post-button";

afterEach(() => {
	cleanup();
});

describe("ForumNewPostButton — iPhone mobile-trim contract", () => {
	it("button carries `hidden sm:inline-block` so it is hidden on phones", () => {
		render(
			createElement(ForumNewPostButton, {
				forumId: 1,
				forumName: "test",
				selfEmailVerifiedAt: 1,
				threadTypes: null,
			}),
		);
		const button = screen.getByTestId("forum-new-post-button");
		expect(button.tagName).toBe("BUTTON");
		expect(button.className).toContain("hidden");
		expect(button.className).toContain("sm:inline-block");
	});

	it("still renders the 发表新帖 image (desktop unchanged)", () => {
		render(
			createElement(ForumNewPostButton, {
				forumId: 1,
				forumName: "test",
				selfEmailVerifiedAt: 1,
				threadTypes: null,
			}),
		);
		const img = screen.getByAltText("发表新帖") as HTMLImageElement;
		expect(img).toBeDefined();
		expect(img.getAttribute("src")).toBe("/static/pn_post.png");
	});
});
