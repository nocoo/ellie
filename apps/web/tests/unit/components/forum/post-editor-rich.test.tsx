// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostEditor, type PostEditorRef } from "@/components/forum/post-editor";

const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/forum-browser-api", () => ({
	uploadPostImage: (...args: unknown[]) => upload(...args),
}));

beforeEach(() => upload.mockReset());
afterEach(cleanup);

function editorView(content = "<p>Original content</p>") {
	const ref = createRef<PostEditorRef>();
	const onSubmit = vi.fn();
	const onBusyChange = vi.fn();
	const view = render(
		<ForumToastProvider>
			<PostEditor
				ref={ref}
				initialContent={content}
				onSubmit={onSubmit}
				onBusyChange={onBusyChange}
				previewTitle="Preview title"
			/>
		</ForumToastProvider>,
	);
	const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
	return { ...view, ref, onSubmit, onBusyChange, input };
}

it("previews the published rich formatting and leaves the editor document unchanged", async () => {
	const { ref, onSubmit } = editorView(
		"<h2>Heading</h2><ul><li><p>First item</p></li></ul><blockquote><p>Quoted text</p></blockquote><pre><code>const x = 1;</code></pre><p>:laugh:</p>",
	);
	const before = ref.current?.getHTML();
	fireEvent.click(screen.getByRole("tab", { name: "预览" }));
	const preview = screen.getByRole("tabpanel", { name: "预览" });
	expect(within(preview).getByRole("heading", { name: "Heading" })).toBeTruthy();
	expect(preview.querySelector("ul li")?.textContent).toBe("First item");
	expect(preview.querySelector("blockquote")?.textContent).toBe("Quoted text");
	expect(preview.querySelector("pre code")?.textContent).toBe("const x = 1;");
	expect(preview.querySelector("img.smiley")?.getAttribute("src")).toContain("laugh.gif");
	fireEvent.keyDown(preview, { key: "Enter", ctrlKey: true });
	expect(onSubmit).toHaveBeenCalledWith(before);
	fireEvent.click(screen.getByRole("tab", { name: "撰写" }));
	expect(ref.current?.getHTML()).toBe(before);
});

it("does not report content changes when submission locks or unlocks the editor", () => {
	const onChange = vi.fn();
	const onSubmit = vi.fn();
	const view = (submitting: boolean) => (
		<ForumToastProvider>
			<PostEditor
				initialContent="<p>Keep this draft</p>"
				onSubmit={onSubmit}
				onChange={onChange}
				submitting={submitting}
			/>
		</ForumToastProvider>
	);
	const { rerender } = render(view(false));
	rerender(view(true));
	rerender(view(false));
	expect(onChange).not.toHaveBeenCalled();
});

describe("image upload guard", () => {
	it("blocks both submission routes while uploading and preserves text", async () => {
		let finish!: (value: unknown) => void;
		upload.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { ref, input, onSubmit, onBusyChange } = editorView();
		fireEvent.change(input, {
			target: { files: [new File(["png"], "image.png", { type: "image/png" })] },
		});
		act(() => ref.current?.submit());
		expect(onSubmit).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "提交" }).hasAttribute("disabled")).toBe(true);
		expect(onBusyChange).toHaveBeenCalledWith(true);
		await act(async () => finish({ kind: "success", url: "https://example.com/image.png" }));
		expect(ref.current?.getHTML()).toContain("Original content");
		expect(ref.current?.getHTML()).toContain('<img src="https://example.com/image.png"');
		expect(onBusyChange).toHaveBeenLastCalledWith(false);
		act(() => ref.current?.submit());
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it.each([
		[new File(["svg"], "image.svg", { type: "image/svg+xml" }), "仅支持 JPG"],
		[
			new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
			"超过 5 MB",
		],
	])("validates the file before sending it: %s", (file, message) => {
		const { input, ref } = editorView();
		fireEvent.change(input, { target: { files: [file] } });
		expect(upload).not.toHaveBeenCalled();
		expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes(message))).toBe(
			true,
		);
		expect(ref.current?.getHTML()).toBe("<p>Original content</p>");
	});

	it("keeps the draft after an upload failure and retries the selected file", async () => {
		upload
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockResolvedValueOnce({ kind: "success", url: "https://example.com/retry.png" });
		const { input, ref } = editorView();
		const file = new File(["png"], "retry.png", { type: "image/png" });
		fireEvent.change(input, { target: { files: [file] } });
		const retry = await screen.findByRole("button", { name: "重试" });
		expect(ref.current?.getHTML()).toBe("<p>Original content</p>");
		fireEvent.click(retry);
		await waitFor(() => expect(ref.current?.getHTML()).toContain("retry.png"));
		expect(upload.mock.calls).toEqual([[file], [file]]);
	});
});
