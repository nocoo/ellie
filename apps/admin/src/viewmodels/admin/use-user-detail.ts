// viewmodels/admin/use-user-detail.ts — ViewModel for Admin User Detail page
// MVVM Pattern: encapsulates per-user fetch + threads/posts pagination
// for /admin/users/[id]. The actual mutation handlers (edit / unban /
// purge) live next to the destructive UI; this hook only owns reads
// + pagination state so the page composition stays small.

"use client";

import { extractErrorMessage } from "@/lib/admin-error";
import { type Post, fetchPosts } from "@/viewmodels/admin/posts";
import { type Thread, fetchThread, fetchThreads } from "@/viewmodels/admin/threads";
import { type User, fetchUser } from "@/viewmodels/admin/users";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationInfo {
	page: number;
	pages: number;
	total: number;
	limit: number;
}

export interface UserDetailState {
	/** Full user record (null while loading or on error). */
	user: User | null;
	/** Top-level loading state for the user record. */
	loading: boolean;
	/** Top-level error from fetching the user record. */
	error: string | null;

	/** Threads authored by this user (current page). */
	threads: Thread[];
	threadsPagination: PaginationInfo;
	threadsLoading: boolean;
	threadsError: string | null;

	/** Posts authored by this user (current page). */
	posts: UserDetailPost[];
	postsPagination: PaginationInfo;
	postsLoading: boolean;
	postsError: string | null;
}

export interface UserDetailActions {
	/** Re-fetch the user record (after edit/unban). */
	reloadUser: () => Promise<void>;
	/** Switch threads tab to a specific page. */
	setThreadsPage: (page: number) => void;
	/** Switch posts tab to a specific page. */
	setPostsPage: (page: number) => void;
}

export interface UseUserDetailReturn {
	state: UserDetailState;
	actions: UserDetailActions;
}

export interface UseUserDetailOptions {
	/** Admin user id to load (from route param). */
	userId: number;
	/** Page size for threads & posts panels. Default 20. */
	pageSize?: number;
}

/**
 * Post enriched with its parent thread's subject for display in the user
 * detail page (the admin posts list API does not include thread metadata,
 * so we patch it on after the fact via per-thread fetches).
 */
export interface UserDetailPost extends Post {
	/** Subject of the parent thread, or undefined if the lookup failed. */
	threadSubject?: string;
}

/**
 * Patch each post with its parent thread's subject from the lookup map.
 * Posts whose thread is missing from the map keep `threadSubject: undefined`
 * so the UI can fall back to `#${threadId}`. Pure for testability.
 */
export function enrichPostsWithThreadSubjects(
	posts: Post[],
	subjectsByThreadId: Map<number, string>,
): UserDetailPost[] {
	return posts.map((p) => {
		const subject = subjectsByThreadId.get(p.threadId);
		return subject !== undefined ? { ...p, threadSubject: subject } : p;
	});
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PAGINATION: PaginationInfo = { page: 1, pages: 0, total: 0, limit: 20 };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Loads `/api/admin/users/:id` once on mount, then independently paginates
 * threads (`/api/admin/threads?authorId`) and posts (`/api/admin/posts?authorId`).
 *
 * Failures on any panel are surfaced as inline error strings; the other
 * panels keep their data so a 500 on threads doesn't blank the page.
 */
export function useUserDetail({
	userId,
	pageSize = 20,
}: UseUserDetailOptions): UseUserDetailReturn {
	// User record
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Threads panel
	const [threads, setThreads] = useState<Thread[]>([]);
	const [threadsPagination, setThreadsPagination] = useState<PaginationInfo>({
		...DEFAULT_PAGINATION,
		limit: pageSize,
	});
	const [threadsLoading, setThreadsLoading] = useState(true);
	const [threadsError, setThreadsError] = useState<string | null>(null);
	const [threadsPage, setThreadsPageState] = useState(1);

	// Posts panel
	const [posts, setPosts] = useState<UserDetailPost[]>([]);
	const [postsPagination, setPostsPagination] = useState<PaginationInfo>({
		...DEFAULT_PAGINATION,
		limit: pageSize,
	});
	const [postsLoading, setPostsLoading] = useState(true);
	const [postsError, setPostsError] = useState<string | null>(null);
	const [postsPage, setPostsPageState] = useState(1);

	// -------------------------------------------------------------------------
	// User record
	// -------------------------------------------------------------------------

	const reloadUser = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const u = await fetchUser(userId);
			setUser(u);
		} catch (err) {
			setUser(null);
			setError(extractErrorMessage(err, "加载用户失败"));
		} finally {
			setLoading(false);
		}
	}, [userId]);

	useEffect(() => {
		reloadUser();
	}, [reloadUser]);

	// -------------------------------------------------------------------------
	// Threads panel
	// -------------------------------------------------------------------------

	useEffect(() => {
		let cancelled = false;
		setThreadsLoading(true);
		setThreadsError(null);
		fetchThreads({ authorId: userId, page: threadsPage, limit: pageSize })
			.then((res) => {
				if (cancelled) return;
				setThreads(res.data);
				setThreadsPagination({
					page: res.meta.page,
					pages: res.meta.pages,
					total: res.meta.total,
					limit: res.meta.limit,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				setThreads([]);
				setThreadsError(extractErrorMessage(err, "加载主题失败"));
			})
			.finally(() => {
				if (cancelled) return;
				setThreadsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [userId, threadsPage, pageSize]);

	const setThreadsPage = useCallback((page: number) => {
		setThreadsPageState(page);
	}, []);

	// -------------------------------------------------------------------------
	// Posts panel
	// -------------------------------------------------------------------------

	useEffect(() => {
		let cancelled = false;
		setPostsLoading(true);
		setPostsError(null);
		fetchPosts({ authorId: userId, page: postsPage, limit: pageSize })
			.then(async (res) => {
				if (cancelled) return;
				// Show the raw posts immediately, then enrich with thread
				// subjects in a second pass. Each fetchThread is independent —
				// one failure must not blank other rows or the whole list.
				setPosts(res.data);
				setPostsPagination({
					page: res.meta.page,
					pages: res.meta.pages,
					total: res.meta.total,
					limit: res.meta.limit,
				});

				const uniqueThreadIds = Array.from(new Set(res.data.map((p) => p.threadId)));
				if (uniqueThreadIds.length === 0) return;
				const subjectPairs = await Promise.all(
					uniqueThreadIds.map((id) =>
						fetchThread(id)
							.then((t) => [id, t.subject] as const)
							.catch(() => null),
					),
				);
				if (cancelled) return;
				const subjectsByThreadId = new Map<number, string>();
				for (const pair of subjectPairs) {
					if (pair) subjectsByThreadId.set(pair[0], pair[1]);
				}
				setPosts((prev) => enrichPostsWithThreadSubjects(prev, subjectsByThreadId));
			})
			.catch((err) => {
				if (cancelled) return;
				setPosts([]);
				setPostsError(extractErrorMessage(err, "加载帖子失败"));
			})
			.finally(() => {
				if (cancelled) return;
				setPostsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [userId, postsPage, pageSize]);

	const setPostsPage = useCallback((page: number) => {
		setPostsPageState(page);
	}, []);

	return {
		state: {
			user,
			loading,
			error,
			threads,
			threadsPagination,
			threadsLoading,
			threadsError,
			posts,
			postsPagination,
			postsLoading,
			postsError,
		},
		actions: {
			reloadUser,
			setThreadsPage,
			setPostsPage,
		},
	};
}
