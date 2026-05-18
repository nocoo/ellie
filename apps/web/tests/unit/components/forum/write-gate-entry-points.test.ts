// @vitest-environment happy-dom
// Tests that write-gate preflight blocks report/comment dialogs from opening.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Write-gate mock (controllable) ─────────────────────────────────────────

const mockWriteGatePreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: any[]) => mockWriteGatePreflight(...args),
}));

// ─── Shared mocks ───────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
	default: ({ children, ...props }: any) => createElement("a", props, children),
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatDateTime: () => "2026-01-01",
	formatRelativeTime: () => "刚刚",
}));

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
}));

vi.mock("@/viewmodels/forum/use-post-actions", () => ({
	usePostActions: () => ({
		state: { editOpen: false, deleteOpen: false },
		actions: { handleEdit: vi.fn(), handleDeleteClick: vi.fn(), handleDeleteConfirm: vi.fn() },
	}),
}));

// Stub dialogs to detect open state
const reportDialogProps = vi.fn();
vi.mock("@/components/forum/report-dialog", () => ({
	ReportDialog: (props: any) => {
		reportDialogProps(props);
		return props.open ? createElement("div", { "data-testid": "report-dialog" }) : null;
	},
}));

const commentDialogProps = vi.fn();
vi.mock("@/components/forum/post-comments", () => ({
	PostComments: (props: any) => {
		commentDialogProps(props);
		return props.dialogOpen
			? createElement("div", { "data-testid": "comment-dialog" })
			: createElement("div", { "data-testid": "comments-section" });
	},
}));

vi.mock("@/components/forum/post-edit-dialog", () => ({
	PostEditDialog: () => null,
}));

vi.mock("@/components/forum/post-rating-dialog", () => ({
	PostRatingDialog: () => null,
}));

vi.mock("@/components/forum/post-content", () => ({
	PostContent: ({ actionBar, comments }: any) =>
		createElement("div", { "data-testid": "post-content" }, actionBar, comments),
}));

vi.mock("@/components/forum/post-sidebar", () => ({
	PostSidebar: () => createElement("div", { "data-testid": "post-sidebar" }),
}));

vi.mock("@/components/forum/post-author-status-icon", () => ({
	PostAuthorStatusIcon: () => null,
}));

vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => createElement("div", { "data-testid": "avatar" }),
}));

vi.mock("@/components/ui/avatar", () => ({
	Avatar: ({ children }: any) => createElement("div", null, children),
	AvatarFallback: ({ children }: any) => createElement("span", null, children),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: () => null,
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { PostCard } from "@/components/forum/post-card";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePost(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		threadId: 10,
		authorId: 100,
		content: "<p>Hello</p>",
		createdAt: 1700000000,
		updatedAt: 1700000000,
		position: 2,
		isFirst: false,
		canEdit: false,
		canDelete: false,
		author: { id: 100, username: "alice", role: "user", groupTitle: null },
		attachments: [],
		comments: [],
		...overrides,
	} as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PostCard write-gate integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteGatePreflight.mockResolvedValue(false); // default: allowed
	});
	afterEach(cleanup);

	describe("report button", () => {
		it("opens report dialog when write-gate allows", async () => {
			render(
				createElement(PostCard, {
					post: makePost(),
					canModerate: false,
					currentUserId: 999, // not own post
					threadAuthorId: 100,
				}),
			);

			// PostCard renders actionBar in both desktop + mobile layouts
			const reportBtns = screen.getAllByText("举报");
			fireEvent.click(reportBtns[0]);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "report");
			});
			await waitFor(() => {
				expect(screen.getByTestId("report-dialog")).toBeTruthy();
			});
		});

		it("does NOT open report dialog when write-gate blocks", async () => {
			mockWriteGatePreflight.mockResolvedValue(true); // blocked

			render(
				createElement(PostCard, {
					post: makePost(),
					canModerate: false,
					currentUserId: 999,
					threadAuthorId: 100,
				}),
			);

			const reportBtns = screen.getAllByText("举报");
			fireEvent.click(reportBtns[0]);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "report");
			});
			expect(screen.queryByTestId("report-dialog")).toBeNull();
		});
	});

	describe("comment button", () => {
		it("opens comment dialog when write-gate allows", async () => {
			render(
				createElement(PostCard, {
					post: makePost(),
					canModerate: false,
					currentUserId: 999,
					threadAuthorId: 100,
					threadClosed: false,
				}),
			);

			const commentBtns = screen.getAllByText("点评");
			fireEvent.click(commentBtns[0]);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "comment");
			});
			// Verify PostComments received dialogOpen=true
			await waitFor(() => {
				const lastCall = commentDialogProps.mock.calls[commentDialogProps.mock.calls.length - 1];
				expect(lastCall?.[0]?.dialogOpen).toBe(true);
			});
		});

		it("does NOT open comment dialog when write-gate blocks", async () => {
			mockWriteGatePreflight.mockResolvedValue(true); // blocked

			render(
				createElement(PostCard, {
					post: makePost(),
					canModerate: false,
					currentUserId: 999,
					threadAuthorId: 100,
					threadClosed: false,
				}),
			);

			const commentBtns = screen.getAllByText("点评");
			fireEvent.click(commentBtns[0]);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "comment");
			});
			// PostComments should never receive dialogOpen=true
			const lastCall = commentDialogProps.mock.calls[commentDialogProps.mock.calls.length - 1];
			expect(lastCall?.[0]?.dialogOpen).toBe(false);
		});
	});
});
