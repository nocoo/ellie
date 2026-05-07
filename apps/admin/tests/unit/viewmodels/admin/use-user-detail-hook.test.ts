// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/viewmodels/admin/users", () => ({
	fetchUser: vi.fn(),
}));

vi.mock("@/viewmodels/admin/threads", () => ({
	fetchThreads: vi.fn(),
	fetchThread: vi.fn(),
}));

vi.mock("@/viewmodels/admin/posts", () => ({
	fetchPosts: vi.fn(),
}));

import { fetchPosts } from "@/viewmodels/admin/posts";
import { fetchThread, fetchThreads } from "@/viewmodels/admin/threads";
import { enrichPostsWithThreadSubjects, useUserDetail } from "@/viewmodels/admin/use-user-detail";
import type { User } from "@/viewmodels/admin/users";
import { fetchUser } from "@/viewmodels/admin/users";

const mockFetchUser = fetchUser as ReturnType<typeof vi.fn>;
const mockFetchThreads = fetchThreads as ReturnType<typeof vi.fn>;
const mockFetchThread = fetchThread as ReturnType<typeof vi.fn>;
const mockFetchPosts = fetchPosts as ReturnType<typeof vi.fn>;

const MOCK_USER: User = {
	id: 42,
	username: "carol",
	email: "carol@test.com",
	role: 0,
	status: 0,
	credits: 10,
	threads: 2,
	posts: 5,
	regDate: 1700000000,
	lastLogin: 1700001000,
	avatar: "",
	avatarPath: "",
};

function makePage<T>(data: T[], page = 1, limit = 20) {
	return {
		data,
		meta: { page, pages: 1, total: data.length, limit },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFetchUser.mockResolvedValue(MOCK_USER);
	mockFetchThreads.mockResolvedValue(makePage([{ id: 1, subject: "t" }]));
	mockFetchPosts.mockResolvedValue(makePage([{ id: 2, threadId: 1, content: "p" }]));
	mockFetchThread.mockResolvedValue({ id: 1, subject: "t" });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useUserDetail", () => {
	it("loads user, threads, and posts on mount", async () => {
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
			expect(result.current.state.threadsLoading).toBe(false);
			expect(result.current.state.postsLoading).toBe(false);
		});

		expect(result.current.state.user?.username).toBe("carol");
		expect(result.current.state.threads).toHaveLength(1);
		expect(result.current.state.posts).toHaveLength(1);
		expect(result.current.state.threadsPagination.total).toBe(1);
		expect(result.current.state.postsPagination.total).toBe(1);
		expect(mockFetchThreads).toHaveBeenCalledWith({ authorId: 42, page: 1, limit: 20 });
		expect(mockFetchPosts).toHaveBeenCalledWith({ authorId: 42, page: 1, limit: 20 });
	});

	it("surfaces user fetch failure as inline error", async () => {
		mockFetchUser.mockRejectedValueOnce(new Error("nope"));
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.loading).toBe(false);
		});

		expect(result.current.state.user).toBeNull();
		expect(result.current.state.error).toBeTruthy();
	});

	it("surfaces threads + posts fetch failures independently", async () => {
		mockFetchThreads.mockRejectedValueOnce(new Error("threads boom"));
		mockFetchPosts.mockRejectedValueOnce(new Error("posts boom"));
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.threadsLoading).toBe(false);
			expect(result.current.state.postsLoading).toBe(false);
		});

		expect(result.current.state.threads).toHaveLength(0);
		expect(result.current.state.posts).toHaveLength(0);
		expect(result.current.state.threadsError).toBeTruthy();
		expect(result.current.state.postsError).toBeTruthy();
	});

	it("setThreadsPage triggers refetch with new page", async () => {
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.threadsLoading).toBe(false);
		});
		mockFetchThreads.mockClear();
		mockFetchThreads.mockResolvedValue(makePage([], 3));

		act(() => {
			result.current.actions.setThreadsPage(3);
		});

		await waitFor(() => {
			expect(mockFetchThreads).toHaveBeenCalledWith({ authorId: 42, page: 3, limit: 20 });
		});
	});

	it("setPostsPage triggers refetch with new page", async () => {
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.postsLoading).toBe(false);
		});
		mockFetchPosts.mockClear();
		mockFetchPosts.mockResolvedValue(makePage([], 2));

		act(() => {
			result.current.actions.setPostsPage(2);
		});

		await waitFor(() => {
			expect(mockFetchPosts).toHaveBeenCalledWith({ authorId: 42, page: 2, limit: 20 });
		});
	});

	it("reloadUser refetches the user record", async () => {
		const { result } = renderHook(() => useUserDetail({ userId: 42 }));
		await waitFor(() => expect(result.current.state.loading).toBe(false));

		mockFetchUser.mockClear();
		mockFetchUser.mockResolvedValue({ ...MOCK_USER, credits: 999 });

		await act(async () => {
			await result.current.actions.reloadUser();
		});

		expect(mockFetchUser).toHaveBeenCalledWith(42);
		expect(result.current.state.user?.credits).toBe(999);
	});

	it("respects custom pageSize", async () => {
		renderHook(() => useUserDetail({ userId: 7, pageSize: 5 }));

		await waitFor(() => {
			expect(mockFetchThreads).toHaveBeenCalledWith({ authorId: 7, page: 1, limit: 5 });
			expect(mockFetchPosts).toHaveBeenCalledWith({ authorId: 7, page: 1, limit: 5 });
		});
	});

	it("dedupes threadIds when enriching posts with thread subjects", async () => {
		mockFetchPosts.mockResolvedValue(
			makePage([
				{ id: 10, threadId: 100, content: "a" },
				{ id: 11, threadId: 100, content: "b" },
				{ id: 12, threadId: 200, content: "c" },
			]),
		);
		mockFetchThread.mockImplementation((id: number) =>
			Promise.resolve({ id, subject: `Subject ${id}` }),
		);

		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.posts[0]?.threadSubject).toBe("Subject 100");
			expect(result.current.state.posts[1]?.threadSubject).toBe("Subject 100");
			expect(result.current.state.posts[2]?.threadSubject).toBe("Subject 200");
		});

		expect(mockFetchThread).toHaveBeenCalledTimes(2);
		expect(mockFetchThread).toHaveBeenCalledWith(100);
		expect(mockFetchThread).toHaveBeenCalledWith(200);
	});

	it("falls back to undefined threadSubject when fetchThread fails for one id", async () => {
		mockFetchPosts.mockResolvedValue(
			makePage([
				{ id: 10, threadId: 100, content: "a" },
				{ id: 11, threadId: 200, content: "b" },
			]),
		);
		mockFetchThread.mockImplementation((id: number) =>
			id === 200
				? Promise.reject(new Error("boom"))
				: Promise.resolve({ id, subject: `Subject ${id}` }),
		);

		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.postsLoading).toBe(false);
		});

		expect(result.current.state.posts).toHaveLength(2);
		expect(result.current.state.posts[0]?.threadSubject).toBe("Subject 100");
		expect(result.current.state.posts[1]?.threadSubject).toBeUndefined();
		// Surface error must NOT be set — partial enrichment is best-effort.
		expect(result.current.state.postsError).toBeNull();
	});

	it("skips enrichment when posts list is empty", async () => {
		mockFetchPosts.mockResolvedValue(makePage([]));

		const { result } = renderHook(() => useUserDetail({ userId: 42 }));

		await waitFor(() => {
			expect(result.current.state.postsLoading).toBe(false);
		});

		expect(mockFetchThread).not.toHaveBeenCalled();
		expect(result.current.state.posts).toHaveLength(0);
	});
});

describe("enrichPostsWithThreadSubjects", () => {
	it("attaches threadSubject when present in the lookup map", () => {
		const out = enrichPostsWithThreadSubjects(
			[{ id: 1, threadId: 10 } as never, { id: 2, threadId: 20 } as never],
			new Map([
				[10, "ten"],
				[20, "twenty"],
			]),
		);
		expect(out[0]?.threadSubject).toBe("ten");
		expect(out[1]?.threadSubject).toBe("twenty");
	});

	it("leaves threadSubject undefined when the threadId is missing from the map", () => {
		const out = enrichPostsWithThreadSubjects(
			[{ id: 1, threadId: 99 } as never],
			new Map([[10, "ten"]]),
		);
		expect(out[0]?.threadSubject).toBeUndefined();
	});
});
