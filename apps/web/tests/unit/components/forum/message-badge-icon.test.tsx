// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageBadgeIcon } from "@/components/forum/message-badge-icon";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), id: "10" }));
vi.mock("next-auth/react", () => ({
	useSession: () => ({
		status: "authenticated",
		data: { user: { id: mocks.id, provider: "credentials" } },
	}),
}));
vi.mock("@/viewmodels/forum/messages", () => ({
	fetchUnreadCount: mocks.fetch,
	MESSAGE_BADGE_REFRESH_EVENT: "ellie:messages-changed",
}));
vi.mock("@/components/header-links", () => ({
	HeaderTooltip: ({ children }: { children: ReactNode }) => children,
}));
beforeEach(() => {
	vi.useFakeTimers();
	mocks.id = String(Number(mocks.id) + 1);
	mocks.fetch.mockReset().mockResolvedValue(1);
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
function visibility(value: string) {
	Object.defineProperty(document, "visibilityState", { configurable: true, value });
	document.dispatchEvent(new Event("visibilitychange"));
}
it("checks once per hour, pauses while hidden, and does not refetch on early refocus", async () => {
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1_800_000);
		visibility("hidden");
		visibility("visible");
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1_800_000);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	visibility("hidden");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(7_200_000);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	await act(async () => {
		visibility("visible");
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(3);
	cleanup();
	await vi.advanceTimersByTimeAsync(3_600_000);
	expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("shares the polling deadline across page remounts and isolates accounts", async () => {
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	cleanup();
	await vi.advanceTimersByTimeAsync(60_000);
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	cleanup();
	mocks.id = "999";
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("refreshes on mailbox activity and ignores older request results", async () => {
	let resolveOld: (value: number) => void = () => {};
	mocks.fetch.mockReturnValueOnce(
		new Promise<number>((resolve) => {
			resolveOld = resolve;
		}),
	);
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	mocks.fetch.mockResolvedValueOnce(2);
	await act(async () => {
		window.dispatchEvent(new Event("ellie:messages-changed"));
	});
	expect(screen.getByTestId("message-badge-count").textContent).toBe("2");
	await act(async () => {
		resolveOld(8);
	});
	expect(screen.getByTestId("message-badge-count").textContent).toBe("2");
});

it("contains rejected checks and retries at the next hourly deadline", async () => {
	mocks.fetch.mockRejectedValueOnce(new Error("offline"));
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(3_600_000);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	expect(screen.getByTestId("message-badge-count").textContent).toBe("1");
});
