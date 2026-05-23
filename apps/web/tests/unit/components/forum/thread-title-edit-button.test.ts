// @vitest-environment happy-dom
// Tests for ThreadTitleEditButton — Pencil entry next to <h1>.
// Reviewer freeze msg=a8ee78db Directive 9: the entry MUST carry the
// `hidden sm:inline-flex` class pair so phones never see it (mobile UX
// keeps the title row uncluttered; subject edit is desktop-only).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the dialog out — we're only asserting button presentation +
// open-state wiring, not the dialog body.
vi.mock("@/components/forum/thread-title-edit-dialog", () => ({
	ThreadTitleEditDialog: ({ open }: { open: boolean }) =>
		open ? createElement("div", { "data-testid": "dialog-open" }) : null,
}));

import { ThreadTitleEditButton } from "@/components/forum/thread-title-edit-button";

afterEach(() => {
	cleanup();
});

describe("ThreadTitleEditButton — PC-only entry", () => {
	it("renders a button hidden on mobile via `hidden sm:inline-flex`", () => {
		render(
			createElement(ThreadTitleEditButton, {
				threadId: 5,
				currentSubject: "Hello",
			}),
		);
		const button = screen.getByRole("button", { name: "编辑主题标题" });
		expect(button.tagName).toBe("BUTTON");
		// Both halves are required: `hidden` for the phone hide, and
		// `sm:inline-flex` for the desktop reveal — drop either and the
		// entry behaves wrong on one breakpoint.
		expect(button.className).toContain("hidden");
		expect(button.className).toContain("sm:inline-flex");
	});

	it("dialog is closed by default and opens after click", () => {
		render(
			createElement(ThreadTitleEditButton, {
				threadId: 5,
				currentSubject: "Hello",
			}),
		);
		expect(screen.queryByTestId("dialog-open")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "编辑主题标题" }));
		expect(screen.getByTestId("dialog-open")).toBeTruthy();
	});
});
