// @vitest-environment happy-dom
// Tests that write-gate preflight blocks user-popover "发站内信" navigation.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Write-gate mock (controllable) ─────────────────────────────────────────

const mockWriteGatePreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: any[]) => mockWriteGatePreflight(...args),
}));

// ─── Shared mocks ───────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockRouterPush, refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: { user: { id: "1", role: 1 } } }),
}));

vi.mock("next/link", () => ({
	default: ({ children, href }: any) => createElement("a", { href }, children),
}));

// Mock api-client — return user data
const mockUser = {
	id: 42,
	username: "testuser",
	role: 0,
	status: 0,
	threads: 10,
	posts: 50,
	credits: 100,
	digestPosts: 2,
	regDate: "2024-01-01",
	lastActivity: "2024-06-01",
	olTime: 100,
	bio: "",
	groupTitle: "",
	groupColor: "",
	groupStars: 0,
	customTitle: "",
	avatarPath: "",
	qq: "",
	site: "",
	regIp: "",
	lastIp: "",
};

const mockGet = vi.fn(async () => ({ data: mockUser }));
vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: (...args: any[]) => mockGet(...args),
		post: vi.fn(async () => ({ data: {} })),
	},
}));

vi.mock("@/lib/avatar", () => ({
	getAvatarUrl: () => "/avatar.png",
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatLocaleDate: () => "2024-01-01",
	formatNumber: (n: number) => String(n),
}));

vi.mock("@/viewmodels/shared/user-display", () => ({
	formatLastActive: () => "刚刚",
	getRoleBadge: () => null,
}));

vi.mock("@ellie/types", () => ({
	isUserBanned: (s: number | null) => s === -1,
	isUserMuted: (s: number | null) => s === -2,
}));

vi.mock("./user-avatar", () => ({
	UserAvatar: () => createElement("img", { alt: "avatar" }),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: any) => createElement("span", null, children),
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, onClick, disabled, title }: any) =>
		createElement("button", { type: "button", onClick, disabled, title }, children),
}));

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children, open, onOpenChange }: any) => {
		// Auto-open for test convenience
		if (!open) onOpenChange?.(true);
		return createElement("div", null, children);
	},
	PopoverContent: ({ children }: any) => createElement("div", null, children),
	PopoverTrigger: ({ children }: any) => createElement("div", null, children),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: any) => createElement("div", null, children),
	DropdownMenuContent: ({ children }: any) => createElement("div", null, children),
	DropdownMenuItem: ({ children, onClick, disabled }: any) =>
		createElement("button", { type: "button", onClick, disabled }, children),
	DropdownMenuSeparator: () => createElement("hr"),
	DropdownMenuTrigger: ({ render }: any) => render,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: any) => (open ? createElement("div", null, children) : null),
	DialogContent: ({ children }: any) => createElement("div", null, children),
	DialogDescription: ({ children }: any) => createElement("p", null, children),
	DialogFooter: ({ children }: any) => createElement("div", null, children),
	DialogHeader: ({ children }: any) => createElement("div", null, children),
	DialogTitle: ({ children }: any) => createElement("h2", null, children),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { UserPopover } from "@/components/forum/user-popover";

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderPopover() {
	mockGet.mockResolvedValueOnce({ data: mockUser }).mockResolvedValueOnce({ data: { status: 0 } });
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(UserPopover, { userId: 42 }, createElement("span", null, "trigger")),
		),
	);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("UserPopover write-gate for 发站内信", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteGatePreflight.mockResolvedValue(false); // default: allowed
	});
	afterEach(cleanup);

	it("navigates to /messages?to=N when write-gate allows", async () => {
		renderPopover();

		// Wait for popover to load user data and render "发站内信"
		await waitFor(() => {
			expect(screen.getByText("发站内信")).toBeTruthy();
		});

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		await waitFor(() => {
			expect(mockRouterPush).toHaveBeenCalledWith("/messages?to=42");
		});
	});

	it("does NOT navigate when write-gate blocks", async () => {
		mockWriteGatePreflight.mockResolvedValue(true); // blocked
		renderPopover();

		await waitFor(() => {
			expect(screen.getByText("发站内信")).toBeTruthy();
		});

		fireEvent.click(screen.getByText("发站内信"));

		await waitFor(() => {
			expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
		});
		expect(mockRouterPush).not.toHaveBeenCalled();
	});
});
