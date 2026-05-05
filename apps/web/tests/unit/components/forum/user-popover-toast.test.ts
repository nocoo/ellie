// @vitest-environment happy-dom
// Tests for UserPopover mod action toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock api-client
const mockPost = vi.fn(async () => ({ data: {} }));
const mockGet = vi.fn(async () => ({ data: { status: 0 } }));
vi.mock("@/lib/api-client", () => ({
	apiClient: {
		post: (...args: any[]) => mockPost(...args),
		get: (...args: any[]) => mockGet(...args),
	},
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: { user: { id: "1", role: 1 } } }),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Mock next/link
vi.mock("next/link", () => ({
	default: ({ children, href }: any) => createElement("a", { href }, children),
}));

// Mock avatar helpers
vi.mock("@/lib/avatar", () => ({
	getAvatarUrl: () => "/avatar.png",
}));

// Mock formatting
vi.mock("@/viewmodels/shared/formatting", () => ({
	formatLocaleDate: () => "2024-01-01",
	formatNumber: (n: number) => String(n),
}));
vi.mock("@/viewmodels/shared/user-display", () => ({
	formatLastActive: () => "刚刚",
	getRoleBadge: () => null,
}));

// Mock types helpers
vi.mock("@ellie/types", () => ({
	isUserBanned: (s: number | null) => s === -1,
	isUserMuted: (s: number | null) => s === -2,
}));

// Mock user-avatar
vi.mock("./user-avatar", () => ({
	UserAvatar: () => createElement("img", { alt: "avatar" }),
}));

// Mock UI components for simpler rendering
vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: any) => createElement("span", null, children),
}));
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, onClick, disabled, title }: any) =>
		createElement("button", { type: "button", onClick, disabled, title }, children),
}));
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: any) => (open ? createElement("div", null, children) : null),
	DialogContent: ({ children }: any) => createElement("div", null, children),
	DialogDescription: ({ children }: any) => createElement("p", null, children),
	DialogFooter: ({ children }: any) => createElement("div", null, children),
	DialogHeader: ({ children }: any) => createElement("div", null, children),
	DialogTitle: ({ children }: any) => createElement("h2", null, children),
}));
vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children, open, onOpenChange }: any) => {
		// Always render children, auto-open
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

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { UserPopover } from "@/components/forum/user-popover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function renderPopover() {
	// Mock get to return user data on first call, status on second
	mockGet.mockResolvedValueOnce({ data: mockUser }).mockResolvedValueOnce({ data: { status: 0 } });

	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(UserPopover, { userId: 42 }, createElement("span", null, "trigger")),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UserPopover mod action toast integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on mute action", async () => {
		mockPost.mockResolvedValueOnce({ data: {} });
		renderPopover();

		// Wait for user data to load and mod menu to appear
		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		// Click mute
		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		// Confirmation dialog should appear — click confirm
		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		// Mock the refresh calls after action
		mockGet
			.mockResolvedValueOnce({ data: mockUser })
			.mockResolvedValueOnce({ data: { status: -2 } });

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("禁止发言成功"));
			expect(successToast).toBeTruthy();
		});
	});

	it("shows error toast with Error.message on failure", async () => {
		mockPost.mockRejectedValueOnce(new Error("权限不足"));
		renderPopover();

		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("权限不足"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("禁止发言失败");
		});
	});

	it("shows error toast with fallback on non-Error failure", async () => {
		mockPost.mockRejectedValueOnce("unknown");
		renderPopover();

		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("请稍后重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("禁止发言失败");
		});
	});
});
