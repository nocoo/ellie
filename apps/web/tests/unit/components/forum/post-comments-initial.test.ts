// @vitest-environment happy-dom
// Tests for PostComments fresh thread-context props:
// 1. Initial comments are rendered without per-post fetching.
// 2. Empty success and load failure are distinct.
// 3. Props replace stale state when Next refreshes the same post key.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: routerMocks.refresh }),
}));

// Mock apiClient before importing component
vi.mock("@/lib/api-client", () => ({
	apiClient: {
		post: vi.fn(),
		get: vi.fn(),
	},
}));

// Mock next/link as a passthrough
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

import type { PostComment } from "@ellie/types";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostComments } from "@/components/forum/post-comments";
import { apiClient } from "@/lib/api-client";

vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: ({ avatarPath }: { avatarPath: string }) =>
		createElement("span", { "data-testid": "comment-avatar", "data-path": avatarPath }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleComments: PostComment[] = [
	{
		id: 1,
		threadId: 1,
		postId: 42,
		authorId: 10,
		authorName: "alice",
		authorAvatarPath: "avatars/alice.jpg",
		content: "Nice post!",
		score: 0,
		replyPostId: 0,
		createdAt: 1711540800,
	},
	{
		id: 2,
		threadId: 1,
		postId: 42,
		authorId: 20,
		authorName: "bob",
		authorAvatarPath: "",
		content: "I agree",
		score: 0,
		replyPostId: 0,
		createdAt: 1711540801,
	},
];

function renderWithInitialComments(
	initialComments: PostComment[] | null = [],
	commentLoadError: "load_failed" | "too_large" | null = null,
) {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostComments, {
				postId: 42,
				isLoggedIn: true,
				threadClosed: false,
				initialComments,
				commentLoadError,
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PostComments initialComments", () => {
	beforeEach(() => {
		routerMocks.refresh.mockReset();
		vi.mocked(apiClient.get).mockReset();
		vi.mocked(apiClient.post).mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("does NOT call apiClient.get when initialComments is provided", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});
		expect(
			screen.getAllByTestId("comment-avatar").map((avatar) => avatar.getAttribute("data-path")),
		).toEqual(["avatars/alice.jpg", ""]);

		// Wait a tick to ensure useEffect would have fired if it was going to
		await waitFor(() => {
			expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
		});
	});

	it("renders SSR-provided comments without fetching", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});

		// Both comments should be rendered
		expect(screen.getByText("Nice post!")).toBeTruthy();
		expect(screen.getByText("I agree")).toBeTruthy();
		// Author names should appear
		expect(screen.getByText("alice")).toBeTruthy();
		expect(screen.getByText("bob")).toBeTruthy();
		// And no fetch was made
		expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
	});

	it("renders nothing and does NOT fetch when initialComments is empty array", async () => {
		renderWithInitialComments([]);
		await act(async () => {});

		// Empty initialComments = component knows there are no comments, no fetch needed
		expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
	});

	// ─── Fresh thread-context comments (no per-post fallback fetch) ───
	it("distinguishes [] success from null load failure without per-post fetching", async () => {
		const { unmount } = renderWithInitialComments([]);
		await act(async () => {});
		expect(screen.queryByRole("button", { name: "查看点评" })).toBeNull();
		expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
		unmount();

		renderWithInitialComments(null, "load_failed");
		expect(screen.queryByRole("button", { name: "查看点评" })).toBeNull();
		expect(screen.getByRole("button", { name: "刷新重试" })).toBeTruthy();
		expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
	});

	it("expands the complete preloaded collection beyond 100 comments", async () => {
		const comments = Array.from({ length: 101 }, (_, index) => ({
			...sampleComments[0],
			id: index + 1,
			content: `Comment ${index + 1}`,
		}));
		renderWithInitialComments(comments);
		fireEvent.click(await screen.findByRole("button", { name: "查看全部 101 条点评" }));
		expect(screen.getByText("Comment 101")).toBeTruthy();
		expect(screen.getAllByTestId("post-comment-time")).toHaveLength(101);
		expect(apiClient.get).not.toHaveBeenCalled();
	});

	it("replaces same-post props on refresh instead of unioning stale comments", async () => {
		const renderTree = (comments: PostComment[] | null) =>
			createElement(
				ForumToastProvider,
				null,
				createElement(PostComments, {
					postId: 42,
					isLoggedIn: true,
					threadClosed: false,
					initialComments: comments,
					commentLoadError: null,
				}),
			);
		const view = render(renderTree([sampleComments[0]]));
		expect(screen.getByText("Nice post!")).toBeTruthy();
		view.rerender(renderTree([sampleComments[1]]));
		expect(screen.queryByText("Nice post!")).toBeNull();
		expect(screen.getByText("I agree")).toBeTruthy();
		view.rerender(renderTree([]));
		expect(screen.queryByText("I agree")).toBeNull();
		expect(apiClient.get).not.toHaveBeenCalled();
	});

	it("renders preloaded comments without fetching", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});
		expect(screen.getByText("Nice post!")).toBeTruthy();
		expect(screen.getByText("I agree")).toBeTruthy();
		expect(apiClient.get).not.toHaveBeenCalled();
	});

	// ─── Font baseline (14/12) ────────────────────────────────────────────
	// Per zheng-li msg=79ecfd3d, auxiliary meta info (timestamps, usernames,
	// stats) must be text-xs (12px). The comment timestamp used to be
	// text-2xs (banned per house rule — 12px is the floor); pin text-xs
	// here so it can never silently regress.

	it("shows a confirmed write and refresh failure together and preserves both on null props", async () => {
		const newComment: PostComment = {
			id: 99,
			threadId: 1,
			postId: 42,
			authorId: 10,
			authorName: "alice",
			authorAvatarPath: "avatars/alice.jpg",
			content: "confirmed after refresh failure",
			score: 0,
			replyPostId: 0,
			createdAt: 1711540900,
		};
		vi.mocked(apiClient.post).mockResolvedValueOnce({ data: newComment } as any);
		const renderTree = () =>
			createElement(
				ForumToastProvider,
				null,
				createElement(PostComments, {
					postId: 42,
					isLoggedIn: true,
					threadClosed: false,
					initialComments: null,
					commentLoadError: "load_failed",
					dialogOpen: true,
					onDialogOpenChange: vi.fn(),
				}),
			);
		const view = render(renderTree());
		fireEvent.change(screen.getByPlaceholderText("写下你的点评（最多255字）"), {
			target: { value: newComment.content },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		expect(await screen.findByText(newComment.content)).toBeTruthy();
		expect(screen.getByText("刷新重试")).toBeTruthy();
		view.rerender(renderTree());
		expect(screen.getByText(newComment.content)).toBeTruthy();
		expect(screen.getByText("刷新重试")).toBeTruthy();
		expect(apiClient.get).not.toHaveBeenCalled();
	});

	it("allows router refresh after a fresh-context load failure", async () => {
		routerMocks.refresh.mockReset();
		renderWithInitialComments(null, "load_failed");
		fireEvent.click(screen.getByRole("button", { name: "刷新重试" }));
		expect(routerMocks.refresh).toHaveBeenCalledTimes(1);
		expect(apiClient.get).not.toHaveBeenCalled();
	});

	it("comment timestamp uses text-xs (12px floor, was text-2xs)", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});

		const times = screen.getAllByTestId("post-comment-time");
		expect(times.length).toBeGreaterThan(0);
		expect(times[0].className).toContain("text-xs");
		expect(times[0].className).not.toContain("text-2xs");
	});
});
