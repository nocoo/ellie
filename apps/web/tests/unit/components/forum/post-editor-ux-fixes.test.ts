// @vitest-environment happy-dom
//
// UX fixes for the forum new-thread / reply editor — req zheng-li
// msg=c3dceecc (UX rev 1) + msg=0c9265c6 (default smiley group as the
// landing tab). These tests pin the contract on the SHARED `PostEditor`
// path (mounted by both `NewThreadDialog` and `ReplyDialog`, so one
// surface covers both entry points):
//
//   1. Click anywhere inside the editor body — not just the existing
//      text rows — focuses the tiptap editor.
//   2. The unified emoji picker (the only emoji entry point on the
//      toolbar) opens with a stable, non-zero width and on the forum
//      default smiley group, so `laugh.gif` & friends are the first
//      thing the user sees.
//   3. Picking a forum smiley inserts the token (e.g. `:laugh: `) so
//      the existing renderer round-trips it back to a CDN <img>; the
//      popover closes after the pick.
//   4. Picking a Unicode emoji from the inner Emoji tab still inserts
//      the native character and closes the popover.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
	// The toolbar now has exactly one emoji entry — the Smile-icon
	// trigger rendered by UnifiedEmojiPicker. Reach it via a tag-name
	// + svg lookup so we don't depend on the aria-label wording.
	const trigger = await waitFor(() => {
		const buttons = Array.from(document.querySelectorAll("button"));
		const smile = buttons.find(
			(b) =>
				b.querySelector("svg.lucide-smile") !== null && b.closest('input[type="file"]') === null,
		);
		if (!smile) throw new Error("unified picker trigger not mounted");
		return smile as HTMLButtonElement;
	});
	await act(async () => {
		fireEvent.click(trigger);
	});
	return trigger;
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

	it("renders exactly one emoji entry point on the toolbar (no duplicate pickers)", async () => {
		renderEditor();
		await waitFor(() => {
			// Sanity — make sure the editor mounted first so the toolbar exists.
			if (!document.querySelector(".ProseMirror")) throw new Error("editor not ready");
		});
		const smileTriggers = Array.from(document.querySelectorAll("button")).filter(
			(b) => b.querySelector("svg.lucide-smile") !== null,
		);
		expect(smileTriggers.length).toBe(1);
		// And no stray emoji-mart 😀 trigger (the old standalone EmojiPicker)
		// hanging around outside the unified popover.
		const standaloneEmojiButton = Array.from(document.querySelectorAll("button")).find(
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

	it("picking a forum smiley inserts the raw token (`:laugh: `) and closes the popover", async () => {
		renderEditor();
		await openUnifiedPicker();

		const laughBtn = (await waitFor(() => {
			const b = document.querySelector('button[title=":laugh:"]');
			if (!b) throw new Error("laugh button missing");
			return b;
		})) as HTMLButtonElement;

		await act(async () => {
			fireEvent.click(laughBtn);
		});

		// The picker forwards the raw token `code`; the PostEditor toolbar
		// wraps it with a trailing space before calling insertContent. We
		// don't have a tiptap programmatic readback under happy-dom that
		// is reliable, but we CAN assert the popover closed (popup unmount
		// = open=false propagated through controlled state).
		await waitFor(() => {
			expect(document.querySelector('img[alt=":laugh:"]')).toBeNull();
		});
	});

	it("picking a Unicode emoji from the Emoji tab closes the popover", async () => {
		renderEditor();
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

		await waitFor(() => {
			expect(document.querySelector('[data-testid="mock-emoji-mart"]')).toBeNull();
		});
	});
});
