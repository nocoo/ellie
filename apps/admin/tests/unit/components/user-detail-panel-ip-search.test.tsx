// UserDetailPanel — 搜索同 IP 用户 button (task #9 Phase C.1).
//
// Reviewer-locked invariants (msg=8367a0ed):
//   1. Dialog mode (`onSearchIp` provided): clicking the per-IP button
//      MUST call `onSearchIp(kind, ip)` with the right discriminator and
//      MUST NOT call `router.push` — the dialog wrapper relies on this
//      so list pagination / filter / selection survive.
//   2. Route fallback (`onSearchIp` undefined): clicking the button
//      navigates via `router.push("/admin/users?<kind>=<ip>")` with
//      `URLSearchParams` encoding so IPv6 colons end up as `%3A`.
//   3. Empty/whitespace IPs do not render the button at all — we never
//      navigate to a filter URL that the worker would treat as "no
//      filter" and return everything.

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPurge, mockReload, readState } = vi.hoisted(() => ({
	mockPurge: vi.fn(),
	mockReload: vi.fn(),
	readState: { error: null as string | null },
}));

vi.mock("@/viewmodels/admin/users", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/viewmodels/admin/users")>()),
	purgeUser: mockPurge,
}));

// Mock `next/navigation` at the module boundary so the panel's
// `useRouter()` hook returns our spy. `useParams` is unused by the panel
// directly but is exported for completeness so other panel consumers
// don't blow up under different test entry points.
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
	useParams: () => ({}),
}));

// Stub the user-detail hook so the panel renders a deterministic User
// with known IPs without hitting `fetch`. Threads / posts panels are
// stubbed empty — they're not on the path we're testing.
vi.mock("@/viewmodels/admin/use-user-detail", () => ({
	useUserDetail: () => ({
		state: {
			user: MOCK_USER,
			loading: false,
			error: readState.error,
			threads: [],
			threadsPagination: { page: 1, pages: 0, total: 0, limit: 20 },
			threadsLoading: false,
			threadsError: null,
			posts: [],
			postsPagination: { page: 1, pages: 0, total: 0, limit: 20 },
			postsLoading: false,
			postsError: null,
		},
		actions: {
			reloadUser: mockReload,
			setThreadsPage: vi.fn(),
			setPostsPage: vi.fn(),
		},
	}),
}));

// IpLookupInline contains a `<Button>` of its own — stubbing it to a
// noop keeps the test asserting only against the new 搜索同 IP 用户
// buttons (otherwise `getAllByRole("button")` would mix them in).
vi.mock("@/components/admin/ip-lookup-inline", () => ({
	IpLookupInline: () => null,
}));

// UserCheckinPanel hits its own API on mount; stub it out so the panel
// renders synchronously without a real fetch.
vi.mock("@/components/admin/user-checkin-panel", () => ({
	UserCheckinPanel: () => null,
}));

vi.mock("@/components/admin/user-write-permission-card", () => ({
	UserWritePermissionCard: () => null,
}));

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UserDetailPanel } from "@/components/admin/user-detail-panel";
import type { User } from "@/viewmodels/admin/users";

const MOCK_USER: User = {
	id: 42,
	username: "alice",
	email: "alice@test.com",
	avatar: "",
	role: 0,
	status: 0,
	threads: 0,
	posts: 0,
	credits: 0,
	coins: 0,
	regDate: 1700000000,
	lastLogin: 1700001000,
	regIp: "1.2.3.4",
	lastIp: "::1",
};

beforeEach(() => {
	mockPush.mockClear();
	mockPurge.mockReset();
	mockReload.mockReset();
	readState.error = null;
});

afterEach(() => {
	cleanup();
});

describe("UserDetailPanel — confirmed purge", () => {
	it.each([false, true])(
		"keeps the receipt visible when a later user read fails (reconciled=%s)",
		async (reconciled) => {
			mockPurge.mockResolvedValue(
				reconciled
					? { purged: true, id: 42, alreadyPurged: true }
					: {
							purged: true,
							id: 42,
							deleted: { threads: 50, posts: 50, comments: 0, attachments: 49, messages: 0 },
							audit: { actorEmail: "", actorName: "" },
							r2: { deletedCount: 50, failed: [] },
						},
			);
			mockReload.mockRejectedValue(new Error("refresh failed"));
			const changed = vi.fn();
			const view = render(<UserDetailPanel userId={42} onChanged={changed} />);
			fireEvent.click(screen.getByTestId("purge-user-button"));
			const dialog = within(screen.getByRole("dialog"));
			fireEvent.change(dialog.getByRole("textbox", { name: "确认文本" }), {
				target: { value: "ok" },
			});
			fireEvent.click(dialog.getByRole("button", { name: "彻底清除", exact: true }));
			await screen.findByText("用户已清除");
			expect(changed).toHaveBeenCalledWith({ kind: "purge", userId: 42 });
			expect(mockReload).not.toHaveBeenCalled();
			readState.error = "refresh failed";
			view.rerender(<UserDetailPanel userId={42} onChanged={changed} />);
			expect(screen.getByText("用户已清除")).toBeDefined();
			expect(screen.queryByText("refresh failed")).toBeNull();
			expect(screen.queryByTestId("purge-user-button")).toBeNull();
			expect(screen.queryByText(MOCK_USER.email)).toBeNull();
		},
	);

	it("keeps an unconfirmed failure in the confirmation dialog", async () => {
		mockPurge.mockRejectedValue(new Error("清除尚未确认"));
		render(<UserDetailPanel userId={42} />);
		fireEvent.click(screen.getByTestId("purge-user-button"));
		const dialog = within(screen.getByRole("dialog"));
		fireEvent.change(dialog.getByRole("textbox", { name: "确认文本" }), {
			target: { value: "ok" },
		});
		fireEvent.click(dialog.getByRole("button", { name: "彻底清除", exact: true }));
		await screen.findByText("清除尚未确认");
		expect(screen.queryByText("用户已清除")).toBeNull();
	});
});

describe("UserDetailPanel — 搜索同 IP 用户", () => {
	it("dialog mode: clicking the regIp button calls onSearchIp('regIp', ip) and does not navigate", () => {
		const onSearchIp = vi.fn();
		render(<UserDetailPanel userId={42} showBack={false} onSearchIp={onSearchIp} />);

		const buttons = screen.getAllByRole("button", { name: /搜索同 IP 用户/ });
		// Two IPs (regIp + lastIp) → two buttons in that DOM order.
		expect(buttons).toHaveLength(2);

		fireEvent.click(buttons[0]);

		expect(onSearchIp).toHaveBeenCalledTimes(1);
		expect(onSearchIp).toHaveBeenCalledWith("regIp", "1.2.3.4");
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("dialog mode: clicking the lastIp button calls onSearchIp('lastIp', ip) with raw IPv6 (no URL encoding leakage)", () => {
		const onSearchIp = vi.fn();
		render(<UserDetailPanel userId={42} showBack={false} onSearchIp={onSearchIp} />);

		const buttons = screen.getAllByRole("button", { name: /搜索同 IP 用户/ });
		fireEvent.click(buttons[1]);

		// Callback receives the raw IP value — the list page does the
		// URLSearchParams encoding when it builds the worker fetch URL.
		expect(onSearchIp).toHaveBeenCalledWith("lastIp", "::1");
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("route fallback mode: clicking regIp button pushes /admin/users?regIp=<ip>", () => {
		render(<UserDetailPanel userId={42} />);

		const buttons = screen.getAllByRole("button", { name: /搜索同 IP 用户/ });
		fireEvent.click(buttons[0]);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith("/admin/users?regIp=1.2.3.4");
	});

	it("route fallback mode: IPv6 colons are URL-encoded as %3A so they don't look like a port", () => {
		render(<UserDetailPanel userId={42} />);

		const buttons = screen.getAllByRole("button", { name: /搜索同 IP 用户/ });
		fireEvent.click(buttons[1]);

		expect(mockPush).toHaveBeenCalledTimes(1);
		// URLSearchParams emits `::1` → `%3A%3A1`. Pin that exactly so a
		// future refactor that drops URLSearchParams and concatenates
		// strings can't silently regress IPv6 handling.
		expect(mockPush).toHaveBeenCalledWith("/admin/users?lastIp=%3A%3A1");
	});
});
