// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostEditor, type PostEditorRef } from "@/components/forum/post-editor";
import { handleSubmitShortcut } from "@/lib/composer-keyboard";

vi.mock("@/components/forum/unified-emoji-picker", () => ({
	UnifiedEmojiPicker: () => null,
}));

afterEach(cleanup);

describe("composer shortcuts", () => {
	it.each([
		{ key: "Enter" },
		{ key: "a", ctrlKey: true },
		{ key: "Enter", ctrlKey: true, shiftKey: true },
		{ key: "Enter", ctrlKey: true, altKey: true },
		{ key: "Enter", ctrlKey: true, isComposing: true },
		{ key: "Enter", ctrlKey: true, keyCode: 229 },
	])("leaves ordinary typing and composition untouched: %j", (init) => {
		const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
		const submit = vi.fn();
		expect(handleSubmitShortcut(event, submit)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(submit).not.toHaveBeenCalled();
	});

	it.each(["ctrlKey", "metaKey"])("consumes %s + Enter before document editing", (modifier) => {
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			[modifier]: true,
			cancelable: true,
		});
		const submit = vi.fn();
		expect(handleSubmitShortcut(event, submit)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(submit).toHaveBeenCalledOnce();
	});

	it("consumes a held shortcut without submitting again", () => {
		const submit = vi.fn();
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			ctrlKey: true,
			repeat: true,
			cancelable: true,
		});
		expect(handleSubmitShortcut(event, submit)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(submit).not.toHaveBeenCalled();
	});
});

describe("real post editor keyboard handling", () => {
	async function mount(canSubmit = true) {
		const onSubmit = vi.fn();
		const ref = createRef<PostEditorRef>();
		render(
			<ForumToastProvider>
				<PostEditor
					ref={ref}
					initialContent="<p>Keep this paragraph intact</p>"
					onSubmit={onSubmit}
					canSubmit={canSubmit}
				/>
			</ForumToastProvider>,
		);
		const input = await screen.findByRole("textbox", { name: "正文" });
		await waitFor(() => expect(ref.current?.getHTML()).toContain("Keep this paragraph intact"));
		return { onSubmit, input, ref };
	}

	it("splits a real paragraph with Enter without a ProseMirror instance conflict", async () => {
		const { input, ref, onSubmit } = await mount();
		act(() => {
			fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
		});
		expect(ref.current?.getHTML().match(/<p>/g)).toHaveLength(2);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it.each(["ctrlKey", "metaKey"])(
		"submits once with %s and preserves the exact content",
		async (modifier) => {
			const { input, ref, onSubmit } = await mount();
			const before = ref.current?.getHTML();
			act(() => {
				fireEvent.keyDown(input, { key: "Enter", keyCode: 13, [modifier]: true });
			});
			expect(onSubmit).toHaveBeenCalledExactlyOnceWith(before);
			expect(ref.current?.getHTML()).toBe(before);
		},
	);

	it("does not insert a hard break when submission is unavailable", async () => {
		const { input, ref, onSubmit } = await mount(false);
		const before = ref.current?.getHTML();
		act(() => {
			fireEvent.keyDown(input, { key: "Enter", keyCode: 13, ctrlKey: true });
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(ref.current?.getHTML()).toBe(before);
	});
});
