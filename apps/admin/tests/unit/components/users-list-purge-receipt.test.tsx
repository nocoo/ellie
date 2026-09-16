// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { mockPurge, user } = vi.hoisted(() => ({
	mockPurge: vi.fn(),
	user: {
		id: 42,
		username: "purge-review-user",
		email: "review@example.invalid",
		avatar: "",
		role: 0,
		status: 0,
		threads: 1,
		posts: 1,
		credits: 0,
		coins: 0,
		regDate: 1_700_000_000,
		lastLogin: 1_700_000_100,
		regIp: "",
		lastIp: "",
	},
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
	useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/viewmodels/admin/users", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/viewmodels/admin/users")>()),
	purgeUser: mockPurge,
}));
vi.mock("@/viewmodels/admin/use-user-detail", () => ({
	useUserDetail: () => ({
		state: {
			user,
			loading: false,
			error: null,
			threads: [],
			threadsLoading: false,
			threadsError: null,
			threadsPagination: { page: 1, pages: 0, total: 0, limit: 20 },
			posts: [],
			postsLoading: false,
			postsError: null,
			postsPagination: { page: 1, pages: 0, total: 0, limit: 20 },
		},
		actions: { reloadUser: vi.fn(), setThreadsPage: vi.fn(), setPostsPage: vi.fn() },
	}),
}));
vi.mock("@/viewmodels/admin/use-write-permission-settings", () => ({
	useWritePermissionSettings: () => ({
		settings: {
			allowNewThread: true,
			allowReply: true,
			postingRestrictionsEnabled: false,
			minRegistrationDays: 0,
			requireAvatar: false,
		},
		loading: false,
		error: null,
	}),
}));
vi.mock("@/components/admin/ip-lookup-inline", () => ({ IpLookupInline: () => null }));
vi.mock("@/components/admin/user-checkin-panel", () => ({ UserCheckinPanel: () => null }));
vi.mock("@/components/admin/user-write-permission-card", () => ({
	UserWritePermissionCard: () => null,
}));

import UsersPage from "@/app/(admin)/admin/users/page";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it.each(["complete", "confirmed", "pending-files"])(
	"keeps the %s receipt accessible after the list refreshes",
	async (outcome) => {
		let listReads = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				listReads += 1;
				return Response.json({
					data: listReads === 1 ? [user] : [],
					meta: { page: 1, pages: 1, total: listReads === 1 ? 1 : 0, limit: 100 },
				});
			}),
		);
		mockPurge.mockResolvedValue(
			outcome === "confirmed"
				? { purged: true, id: 42, alreadyPurged: true }
				: {
						purged: true,
						id: 42,
						deleted: { threads: 1, posts: 1, comments: 0, attachments: 1, messages: 0 },
						audit: { actorEmail: "", actorName: "" },
						r2: {
							deletedCount: outcome === "complete" ? 1 : 0,
							failed:
								outcome === "pending-files"
									? [{ key: "attachments/review.png", error: "storage unavailable" }]
									: [],
						},
					},
		);
		render(<UsersPage />);
		fireEvent.click(
			await screen.findByRole("button", { name: "查看用户「purge-review-user」详情" }),
		);
		fireEvent.click(await screen.findByTestId("purge-user-button"));
		const confirmation = within(screen.getByRole("dialog", { name: "彻底清除用户" }));
		fireEvent.change(confirmation.getByRole("textbox", { name: "确认文本" }), {
			target: { value: "ok" },
		});
		fireEvent.click(confirmation.getByRole("button", { name: "彻底清除", exact: true }));
		await waitFor(() => expect(mockPurge).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(listReads).toBe(2));
		expect(await screen.findByText("用户已清除")).toBeDefined();
		if (outcome === "pending-files") {
			expect(screen.getByText("账号和内容已清除，1 个存储文件的清理尚未确认。")).toBeDefined();
		}
		expect(screen.getByRole("dialog", { name: "用户详情" })).toBeDefined();
		expect(screen.queryByTestId("purge-user-button")).toBeNull();
	},
);
