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

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostComments } from "@/components/forum/post-comments";
import { apiClient } from "@/lib/api-client";
import type { PostComment } from "@ellie/types";

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
});
