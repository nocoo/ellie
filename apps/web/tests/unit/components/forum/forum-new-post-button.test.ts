// @vitest-environment happy-dom
// The secondary new-thread action stays desktop-only; the page header
// provides the mobile entry point.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
	it("keeps the secondary button hidden on phones", () => {
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
		expect(button.className).toContain("sm:inline-flex");
	});

	it("provides an accessible text label for the new-thread action", () => {
		render(
			createElement(ForumNewPostButton, {
				forumId: 1,
				forumName: "test",
				selfEmailVerifiedAt: 1,
				threadTypes: null,
			}),
		);
		expect(screen.getByRole("button", { name: "发表新帖" })).toBeDefined();
	});
});
