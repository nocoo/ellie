// @vitest-environment happy-dom
// Tests that post-sidebar "发站内信" opens ComposeMessageDialog in place
// (no navigation), gated by writeGatePreflight.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Write-gate mock (controllable) ─────────────────────────────────────────

const mockWriteGatePreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: any[]) => mockWriteGatePreflight(...args),
}));

// ─── ComposeMessageDialog mock — track open state and props ─────────────────

const composeDialogProps = vi.fn();
vi.mock("@/components/forum/compose-message-dialog", () => ({
	ComposeMessageDialog: (props: any) => {
		composeDialogProps(props);
		return props.open ? createElement("div", { "data-testid": "compose-dialog" }) : null;
	},
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

	it("opens compose dialog in place when write-gate allows", async () => {
		render(createElement(PostSidebarMessageButton, { userId: 99, username: "Alice" }));

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		await waitFor(() => {
			expect(screen.getByTestId("compose-dialog")).toBeTruthy();
		});

		// Verify initialRecipient is passed correctly
		const lastCall = composeDialogProps.mock.calls.at(-1)?.[0];
		expect(lastCall?.initialRecipient).toEqual({ id: 99, username: "Alice" });
		expect(lastCall?.open).toBe(true);
	});

	it("does NOT open dialog when write-gate blocks", async () => {
		mockWriteGatePreflight.mockResolvedValue(true); // blocked
		render(createElement(PostSidebarMessageButton, { userId: 99, username: "Alice" }));

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		expect(screen.queryByTestId("compose-dialog")).toBeNull();
	});
});
