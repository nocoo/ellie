// @vitest-environment happy-dom
// Component test for AnnouncementCard — pins the four-cell visibility
// matrix documented in the component header:
//
//   announcement | canEdit | rendered output
//   ------------ | ------- | -------------------------------------
//   empty        | false   | renders nothing
//   empty        | true    | renders nothing (header owns empty entry)
//   non-empty    | false   | content card without edit button
//   non-empty    | true    | content card + edit button → opens dialog
//
// Reviewer guidance msg e5bba9a6 #1 — the empty-state edit affordance
// must NOT live in this card; it lives in the header. The card only
// owns populated-state rendering plus the inline edit pencil.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// AnnouncementEditDialog pulls in next/navigation, api-client, etc. We
// only care that the card opens it when the pencil is clicked, so stub
// it with a marker that captures its `open` prop.
let lastDialogProps: { open: boolean; initialAnnouncement: string } | null = null;
vi.mock("@/components/forum/announcement-edit-dialog", () => ({
	AnnouncementEditDialog: (props: {
		open: boolean;
		initialAnnouncement: string;
		onOpenChange: (open: boolean) => void;
	}) => {
		lastDialogProps = { open: props.open, initialAnnouncement: props.initialAnnouncement };
		return props.open
			? createElement("div", { "data-testid": "edit-dialog-marker" }, "dialog-open")
			: null;
	},
}));

import { AnnouncementCard } from "@/components/forum/announcement-card";

afterEach(() => {
	cleanup();
	lastDialogProps = null;
});

describe("AnnouncementCard — visibility matrix", () => {
	it("renders nothing when announcement is empty (regular user)", () => {
		const { container } = render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "测试",
				announcement: "",
				canEdit: false,
			}),
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when announcement is empty (moderator — header owns empty entry)", () => {
		const { container } = render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "测试",
				announcement: "",
				canEdit: true,
			}),
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders the announcement content without an edit button when canEdit=false", () => {
		render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "测试",
				announcement: "<p>Hello <strong>world</strong></p>",
				canEdit: false,
			}),
		);
		expect(screen.getByText("公告")).toBeTruthy();
		expect(screen.getByText("world")).toBeTruthy();
		expect(screen.queryByLabelText("编辑公告")).toBeNull();
	});

	it("renders the edit button when canEdit=true and announcement is non-empty", () => {
		render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "测试",
				announcement: "<p>x</p>",
				canEdit: true,
			}),
		);
		expect(screen.getByLabelText("编辑公告")).toBeTruthy();
	});

	it("clicking the edit button opens the dialog with the current announcement", () => {
		render(
			createElement(AnnouncementCard, {
				forumId: 7,
				forumName: "测试版块",
				announcement: "<p>原文</p>",
				canEdit: true,
			}),
		);
		// Initial state — dialog stub renders null because open=false.
		expect(screen.queryByTestId("edit-dialog-marker")).toBeNull();
		expect(lastDialogProps?.open).toBe(false);
		expect(lastDialogProps?.initialAnnouncement).toBe("<p>原文</p>");

		fireEvent.click(screen.getByLabelText("编辑公告"));
		expect(screen.getByTestId("edit-dialog-marker")).toBeTruthy();
		expect(lastDialogProps?.open).toBe(true);
	});
});

describe("AnnouncementCard — sanitizes content", () => {
	it("strips a <script> tag from the rendered announcement", () => {
		render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "x",
				announcement: '<p>Hi</p><script>alert("xss")</script>',
				canEdit: false,
			}),
		);
		// The sanitized output should not contain the script body.
		expect(document.body.innerHTML).not.toContain("<script");
		expect(document.body.innerHTML).not.toContain("alert");
		expect(screen.getByText("Hi")).toBeTruthy();
	});

	it("forces rel=nofollow noopener and target=_blank on links", () => {
		render(
			createElement(AnnouncementCard, {
				forumId: 1,
				forumName: "x",
				announcement: '<a href="https://example.com">click</a>',
				canEdit: false,
			}),
		);
		const a = document.querySelector("a");
		expect(a).toBeTruthy();
		expect(a?.getAttribute("rel")).toContain("nofollow");
		expect(a?.getAttribute("rel")).toContain("noopener");
		expect(a?.getAttribute("target")).toBe("_blank");
	});
});
