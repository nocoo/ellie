// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
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
vi.mock("@/viewmodels/forum/messages", () => ({ fetchUnreadCount: mocks.fetch }));
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
it("checks once per ten minutes, pauses while hidden, and does not refetch on early refocus", async () => {
	await act(async () => {
		render(<MessageBadgeIcon />);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300_000);
		visibility("hidden");
		visibility("visible");
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300_000);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	visibility("hidden");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1_200_000);
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(2);
	await act(async () => {
		visibility("visible");
	});
	expect(mocks.fetch).toHaveBeenCalledTimes(3);
	cleanup();
	await vi.advanceTimersByTimeAsync(600_000);
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
