// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { send, search, get } = vi.hoisted(() => ({ send: vi.fn(), search: vi.fn(), get: vi.fn() }));
vi.mock("@/viewmodels/forum/messages", async (original) => ({
	...(await original<Record<string, unknown>>()),
	sendMessage: send,
	searchUsers: search,
}));
vi.mock("@/lib/api-client", async (original) => ({
	...(await original<Record<string, unknown>>()),
	apiClient: { get },
}));
vi.mock("@/viewmodels/forum/write-gate", () => ({ writeGatePreflight: async () => false }));
vi.mock("@/components/forum/forum-toast", () => ({
	useForumToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ComposeMessageDialog } from "@/components/forum/compose-message-dialog";
import { ModerationChoiceDialog } from "@/components/forum/moderation-choice-dialog";
import { MoveDialog } from "@/components/forum/move-dialog";

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	vi.useRealTimers();
});

it("ignores old recipient results after a newer search or after clearing input", async () => {
	vi.useFakeTimers();
	let old!: (users: unknown[]) => void;
	let current!: (users: unknown[]) => void;
	search.mockReturnValueOnce(
		new Promise((resolve) => {
			old = resolve;
		}),
	);
	search.mockReturnValueOnce(
		new Promise((resolve) => {
			current = resolve;
		}),
	);
	render(<ComposeMessageDialog open onOpenChange={vi.fn()} />);
	const input = screen.getByLabelText("收信人");
	fireEvent.change(input, { target: { value: "Alice" } });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});
	fireEvent.change(input, { target: { value: "Bob" } });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});
	await act(async () => {
		current([{ id: 2, username: "Bob" }]);
	});
	expect(screen.getByRole("button", { name: "Bob" })).toBeTruthy();
	await act(async () => {
		old([{ id: 1, username: "Alice" }]);
	});
	expect(screen.queryByRole("button", { name: "Alice" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Bob" }));
	fireEvent.click(screen.getByRole("button", { name: "清除收信人" }));
	expect((input as HTMLInputElement).value).toBe("");
	expect(screen.queryByRole("button", { name: "Bob" })).toBeNull();
});

it("sends a message once and prevents closing until its receipt arrives", async () => {
	let finish!: (value: unknown) => void;
	send.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const onOpenChange = vi.fn();
	render(
		<ComposeMessageDialog
			open
			onOpenChange={onOpenChange}
			initialRecipient={{ id: 10, username: "Alice" }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("内容"), { target: { value: "Hello Alice" } });
	const button = screen.getByRole("button", { name: "发送", exact: true });
	await act(async () => {
		fireEvent.click(button);
		fireEvent.click(button);
	});
	expect(send).toHaveBeenCalledExactlyOnceWith({ receiverId: 10, content: "Hello Alice" });
	fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
	expect(onOpenChange).not.toHaveBeenCalled();
	expect((screen.getByRole("button", { name: "清除收信人" }) as HTMLButtonElement).disabled).toBe(
		true,
	);
	await act(async () => {
		finish({ id: 1 });
	});
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("reloads the authoritative moderation choice when reopened", () => {
	const options = [0, 1, 2].map((value) => ({
		value,
		label: `Level ${value}`,
		description: `Description ${value}`,
		icon: null,
	}));
	const props = {
		title: "Choose level",
		description: "Choose one",
		titleIcon: null,
		options,
		onOpenChange: vi.fn(),
		onConfirm: vi.fn(),
	};
	const { rerender } = render(<ModerationChoiceDialog {...props} open defaultValue={0} />);
	fireEvent.click(screen.getByRole("button", { name: "Level 2 Description 2" }));
	rerender(<ModerationChoiceDialog {...props} open={false} defaultValue={1} />);
	rerender(<ModerationChoiceDialog {...props} open defaultValue={1} loading />);
	expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Level 1");
	expect(
		(screen.getByRole("button", { name: "Level 2 Description 2" }) as HTMLButtonElement).disabled,
	).toBe(true);
	fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
	expect(props.onOpenChange).not.toHaveBeenCalled();
});

it("shows failed forum loading, retries, and clears an old move selection", async () => {
	const data = [
		{ id: 1, parentId: 0, type: "forum", name: "Current forum", displayOrder: 0 },
		{ id: 2, parentId: 0, type: "forum", name: "Target forum", displayOrder: 1 },
	];
	get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data });
	const props = { currentForumId: 1, onOpenChange: vi.fn(), onConfirm: vi.fn() };
	const { rerender } = render(<MoveDialog {...props} open />);
	await screen.findByRole("alert");
	fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
	fireEvent.click(await screen.findByRole("button", { name: "Target forum" }));
	expect(
		(screen.getByRole("button", { name: "移动", exact: true }) as HTMLButtonElement).disabled,
	).toBe(false);
	rerender(<MoveDialog {...props} open={false} />);
	rerender(<MoveDialog {...props} open />);
	await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
	expect(
		(screen.getByRole("button", { name: "移动", exact: true }) as HTMLButtonElement).disabled,
	).toBe(true);
	expect(props.onConfirm).not.toHaveBeenCalled();
});
