// @vitest-environment happy-dom
// Tests for PostComments initialComments prop:
// 1. When initialComments is provided, apiClient.get is NOT called (no N+1 fetch)
// 2. When initialComments is omitted, apiClient.get IS called (fallback)
// 3. Initial comments are rendered correctly

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		content: "I agree",
		score: 0,
		replyPostId: 0,
		createdAt: 1711540801,
	},
];

function renderWithInitialComments(initialComments?: PostComment[]) {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostComments, {
				postId: 42,
				isLoggedIn: true,
				threadClosed: false,
				...(initialComments !== undefined ? { initialComments } : {}),
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PostComments initialComments", () => {
	beforeEach(() => {
		vi.mocked(apiClient.get).mockReset();
		vi.mocked(apiClient.post).mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("does NOT call apiClient.get when initialComments is provided", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});

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

	// ─── L3 e2e regression guard ──────────────────────────────────────────
	// Contract: only `initialComments === undefined` triggers a client-side
	// refetch. An empty array is a successful "no comments" result and must
	// be trusted as-is. SSR-batch failure path (see thread-detail.server.ts)
	// returns `undefined` to opt back into client fetch — without this
	// distinction, post-comments stays permanently empty if SSR ever fails.

	it("distinguishes [] (no fetch) from undefined (fetches) — explicit contract", async () => {
		vi.mocked(apiClient.get).mockResolvedValue({ data: sampleComments } as any);

		// Pass [] explicitly — must NOT fetch.
		const { unmount } = renderWithInitialComments([]);
		await act(async () => {});
		expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
		unmount();

		// Pass undefined (omit prop) — MUST fetch.
		renderWithInitialComments(undefined);
		await act(async () => {});
		await waitFor(() => {
			expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(1);
		});
	});

	it("calls apiClient.get fallback when initialComments is NOT provided", async () => {
		vi.mocked(apiClient.get).mockResolvedValue({ data: sampleComments } as any);

		renderWithInitialComments(undefined);
		await act(async () => {});

		await waitFor(() => {
			expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith("/api/v1/post-comments", {
				postId: 42,
			});
		});
	});

	it("renders fetched comments in fallback mode", async () => {
		vi.mocked(apiClient.get).mockResolvedValue({ data: sampleComments } as any);

		renderWithInitialComments(undefined);
		await act(async () => {});

		await waitFor(() => {
			expect(screen.getByText("Nice post!")).toBeTruthy();
			expect(screen.getByText("I agree")).toBeTruthy();
		});
	});

	// ─── Font baseline (14/12) ────────────────────────────────────────────
	// Per zheng-li msg=79ecfd3d, auxiliary meta info (timestamps, usernames,
	// stats) must be text-xs (12px). The comment timestamp used to be
	// text-2xs (banned per house rule — 12px is the floor); pin text-xs
	// here so it can never silently regress.

	it("comment timestamp uses text-xs (12px floor, was text-2xs)", async () => {
		renderWithInitialComments(sampleComments);
		await act(async () => {});

		const times = screen.getAllByTestId("post-comment-time");
		expect(times.length).toBeGreaterThan(0);
		expect(times[0].className).toContain("text-xs");
		expect(times[0].className).not.toContain("text-2xs");
	});
});
