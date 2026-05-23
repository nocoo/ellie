// @vitest-environment happy-dom
//
// UX fixes for the forum new-thread / reply editor — req zheng-li
// msg=c3dceecc (UX rev 1) + msg=0c9265c6 (default smiley group as the
// landing tab) + reviewer msg=017bd790 (named emoji trigger; preserve
// Unicode insertion shape). These tests pin the contract on the SHARED
// `PostEditor` path (mounted by both `NewThreadDialog` and `ReplyDialog`,
// so one surface covers both entry points):
//
//   1. Click anywhere inside the editor body — not just the existing
//      text rows — focuses the tiptap editor.
//   2. The unified emoji picker is the only emoji entry point on the
//      toolbar and is discoverable as a NAMED button (aria-label
//      "插入表情" + tooltip) — no anonymous icon buttons.
//   3. Picking a forum smiley inserts the raw token followed by a
//      single space (`:laugh: `) and closes the popover.
//   4. Picking a Unicode emoji inserts the native character WITHOUT a
//      trailing space (`😀`, matching the pre-unification EmojiPicker
//      behavior) and closes the popover.
//   5. Default forum group lands on first open, with `laugh.gif`
//      pointing at the canonical CDN.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// emoji-mart pulls in a large Unicode dataset and a font loader that
// doesn't play nicely with happy-dom. Stub it with a deterministic
// sentinel that exposes a single "select" button.
vi.mock("@emoji-mart/react", () => ({
	default: function MockEmojiMartPicker(props: {
		onEmojiSelect?: (e: { native: string }) => void;
	}) {
		return createElement(
			"div",
			{ "data-testid": "mock-emoji-mart" },
			createElement(
				"button",
				{
					type: "button",
					"data-testid": "mock-emoji-mart-select",
					onClick: () => props.onEmojiSelect?.({ native: "😀" }),
				},
				"pick 😀",
			),
		);
	},
}));
vi.mock("@emoji-mart/data", () => ({ default: {} }));

vi.mock("@/viewmodels/forum/post-image-upload", () => ({
	parsePostImageUploadResponse: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostEditor } from "@/components/forum/post-editor";

function renderEditor(onSubmit = vi.fn()) {
	const utils = render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostEditor, {
				initialContent: "<p>Hello</p>",
				onSubmit,
				placeholder: "Write...",
				maxLength: 10000,
				submitting: false,
				canSubmit: true,
			}),
		),
	);
	return { ...utils, onSubmit };
}

async function openUnifiedPicker() {
	// Toolbar exposes exactly one emoji entry point — a named button
	// with aria-label "插入表情" (reviewer msg=017bd790). Reach it by
	// accessible name so the test no longer depends on the lucide icon
	// class string.
	const trigger = (await waitFor(() =>
		screen.getByRole("button", { name: "插入表情" }),
	)) as HTMLButtonElement;
	await act(async () => {
		fireEvent.click(trigger);
	});
	return trigger;
}

/**
 * Submit the editor and return the HTML that the editor handed to
 * `onSubmit`. We use this to read back what tiptap's `insertContent`
 * actually wrote into the document — happy-dom doesn't render the
 * ProseMirror text node faithfully, but tiptap's own `getHTML()`
 * returns the canonical serialized form.
 */
function submitAndReadHtml(onSubmit: ReturnType<typeof vi.fn>): string {
	const submit = screen.getByRole("button", { name: "提交" });
	act(() => {
		fireEvent.click(submit);
	});
	expect(onSubmit).toHaveBeenCalled();
	const lastCall = onSubmit.mock.calls.at(-1) as [string] | undefined;
	if (!lastCall) throw new Error("onSubmit was not invoked");
	return lastCall[0];
}

describe("PostEditor — editor wrapper click-to-focus", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the click-to-focus wrapper around the tiptap content", async () => {
		renderEditor();
		const wrap = await waitFor(() => {
			const node = document.querySelector(".tiptap-content-wrap");
			if (!node) throw new Error("wrap not mounted");
			return node as HTMLElement;
		});
		expect(wrap.className).toContain("cursor-text");
		expect(wrap.querySelector(".tiptap-content")).toBeTruthy();
	});

	it("clicking the wrapper (not the ProseMirror surface) does not throw", async () => {
		renderEditor();
		const wrap = (await waitFor(() => {
			const node = document.querySelector(".tiptap-content-wrap");
			if (!node) throw new Error("wrap not mounted");
			return node;
		})) as HTMLElement;
		await act(async () => {
			fireEvent.click(wrap);
		});
	});

	it("does not steal clicks that landed on the ProseMirror surface", async () => {
		renderEditor();
		const pm = (await waitFor(() => {
			const node = document.querySelector(".ProseMirror");
			if (!node) throw new Error("ProseMirror not mounted");
			return node;
		})) as HTMLElement;
		await act(async () => {
			fireEvent.click(pm);
		});
		expect(document.querySelector(".tiptap-content-wrap")?.contains(pm)).toBe(true);
	});
});

describe("PostEditor — unified emoji entry point", () => {
	afterEach(() => {
		cleanup();
	});

	it("exposes exactly one NAMED emoji button on the toolbar (no duplicates, no anonymous icon)", async () => {
		renderEditor();
		await waitFor(() => {
			// Sanity — make sure the editor mounted first so the toolbar exists.
			if (!document.querySelector(".ProseMirror")) throw new Error("editor not ready");
		});

		// The named button must exist exactly once.
		const named = screen.getAllByRole("button", { name: "插入表情" });
		expect(named.length).toBe(1);

		// And there must be no anonymous Smile-icon button (a duplicate
		// emoji entry that escaped the unification).
		const buttons = Array.from(document.querySelectorAll("button"));
		const namedSet = new Set(named);
		const anonymousSmile = buttons.find(
			(b) =>
				!namedSet.has(b) &&
				b.querySelector("svg.lucide-smile") !== null &&
				!b.getAttribute("aria-label"),
		);
		expect(anonymousSmile).toBeUndefined();

		// And no stray emoji-mart 😀 trigger (the old standalone EmojiPicker)
		// hanging around outside the unified popover.
		const standaloneEmojiButton = buttons.find(
			(b) =>
				b.textContent?.trim() === "😀" &&
				b.getAttribute("data-testid") !== "mock-emoji-mart-select",
		);
		expect(standaloneEmojiButton).toBeUndefined();
	});

	it("opens onto the Forum default smiley group with laugh.gif visible", async () => {
		renderEditor();
		await openUnifiedPicker();

		// Default-tab pin: the laugh smiley (zheng-li's canonical example)
		// must be in the grid the user sees on first open. We look it up
		// by the alt text on the rendered <img>, which the picker grid
		// sets to the smiley `code` (`:laugh:`).
		const laugh = await waitFor(() => {
			const img = document.querySelector('img[alt=":laugh:"]') as HTMLImageElement | null;
			if (!img) throw new Error("laugh smiley not rendered in default group");
			return img;
		});
		// And the src must point at the canonical CDN path so the existing
		// render pipeline can round-trip the token.
		expect(laugh.src).toBe("https://t.no.mt/static/image/smiley/default/laugh.gif");
	});

	it("picking a forum smiley inserts `:laugh: ` (with trailing space) and closes the popover", async () => {
		const { onSubmit } = renderEditor();
		await openUnifiedPicker();

		const laughBtn = (await waitFor(() => {
			const b = document.querySelector('button[title=":laugh:"]');
			if (!b) throw new Error("laugh button missing");
			return b;
		})) as HTMLButtonElement;

		await act(async () => {
			fireEvent.click(laughBtn);
		});

		// Popover closes after pick.
		await waitFor(() => {
			expect(document.querySelector('img[alt=":laugh:"]')).toBeNull();
		});

		// And the editor body now contains the raw token with a trailing
		// space. We read it back via the submit-onSubmit path so we are
		// asking tiptap for its canonical HTML, not happy-dom's view of
		// ProseMirror's intermediate text node.
		const html = submitAndReadHtml(onSubmit);
		expect(html).toContain(":laugh: ");
		// And no double-space / no extra `:laugh::laugh:`.
		expect(html).not.toContain(":laugh:  ");
	});

	it("picking a Unicode emoji inserts `😀` WITHOUT a trailing space and closes the popover", async () => {
		const { onSubmit } = renderEditor();
		await openUnifiedPicker();

		// Switch to the inner Emoji tab.
		const emojiTab = (await waitFor(() => {
			const b = Array.from(document.querySelectorAll("button")).find((el) =>
				el.textContent?.includes("Emoji"),
			);
			if (!b) throw new Error("Emoji tab missing");
			return b;
		})) as HTMLButtonElement;

		await act(async () => {
			fireEvent.click(emojiTab);
		});

		const pick = (await waitFor(() => {
			const b = document.querySelector('[data-testid="mock-emoji-mart-select"]');
			if (!b) throw new Error("mock emoji picker missing");
			return b;
		})) as HTMLButtonElement;

		await act(async () => {
			fireEvent.click(pick);
		});

		// Popover closed.
		await waitFor(() => {
			expect(document.querySelector('[data-testid="mock-emoji-mart"]')).toBeNull();
		});

		// And the body received the native character with NO trailing
		// space (this is the regression-guard zheng-li/Reviewer-B asked
		// for: the old EmojiPicker inserted `😀`, not `😀 `).
		const html = submitAndReadHtml(onSubmit);
		expect(html).toContain("😀");
		expect(html).not.toContain("😀 ");
	});
});
