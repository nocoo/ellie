// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostActionBar } from "@/components/forum/post-action-bar";

afterEach(cleanup);

describe("PostActionBar", () => {
	it("ignores a second quote-reply click while the first handoff is still running", async () => {
		let finish!: () => void;
		const onReply = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		render(
			<ForumToastProvider>
				<PostActionBar onReply={onReply} />
			</ForumToastProvider>,
		);
		const reply = screen.getByRole("button", { name: "回复" });
		fireEvent.click(reply);
		fireEvent.click(reply);
		expect(onReply).toHaveBeenCalledTimes(1);
		expect((reply as HTMLButtonElement).disabled).toBe(true);
		await act(async () => {
			finish();
		});
		expect((reply as HTMLButtonElement).disabled).toBe(false);
	});

	it("unlocks after a failed action and provides feedback for a retry", async () => {
		const onReply = vi.fn().mockRejectedValueOnce(new Error("Connection lost"));
		render(
			<ForumToastProvider>
				<PostActionBar onReply={onReply} />
			</ForumToastProvider>,
		);
		const reply = screen.getByRole("button", { name: "回复" });
		await act(async () => fireEvent.click(reply));
		expect(screen.getByRole("alert").textContent).toContain("Connection lost");
		expect((reply as HTMLButtonElement).disabled).toBe(false);
		await act(async () => fireEvent.click(reply));
		expect(onReply).toHaveBeenCalledTimes(2);
	});
});
