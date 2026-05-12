// @vitest-environment happy-dom
// Tests that write-gate preflight blocks post-sidebar "发站内信" navigation.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Write-gate mock (controllable) ─────────────────────────────────────────

const mockWriteGatePreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: any[]) => mockWriteGatePreflight(...args),
}));

// ─── Router mock ────────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockRouterPush, refresh: vi.fn() }),
}));

// ─── Import ─────────────────────────────────────────────────────────────────

import { PostSidebarMessageButton } from "@/components/forum/post-sidebar-message-button";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PostSidebarMessageButton write-gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteGatePreflight.mockResolvedValue(false); // default: allowed
	});
	afterEach(cleanup);

	it("navigates to /messages?to=N when write-gate allows", async () => {
		render(createElement(PostSidebarMessageButton, { userId: 99 }));

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		await waitFor(() => {
			expect(mockRouterPush).toHaveBeenCalledWith("/messages?to=99");
		});
	});

	it("does NOT navigate when write-gate blocks", async () => {
		mockWriteGatePreflight.mockResolvedValue(true); // blocked
		render(createElement(PostSidebarMessageButton, { userId: 99 }));

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		expect(mockRouterPush).not.toHaveBeenCalled();
	});
});
