// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls Worker API (GET /api/v1/threads/:id + GET /api/v1/posts + GET /api/v1/posts/:id/attachments + GET /api/v1/users/:id).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { buildThreadBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getPostsPerPage } from "@/lib/forum-settings";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import {
	type Attachment,
	type Forum,
	type Post,
	type PublicUser,
	type Thread,
	type User,
	type UserRole,
	UserStatus,
	canDeleteThread,
	canManageThread,
	canModerate,
	canMoveThread,
	findForumAncestors,
} from "@ellie/types";
import {
	type EnrichedPost,
	enrichPosts,
	groupAttachmentsByPostId,
	uniqueAuthorIds,
} from "./thread-detail";

export interface ThreadDetailPageData {
	thread: Thread | null;
	forum: Forum | null;
	forums: Forum[];
	posts: EnrichedPost[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
	breadcrumbs: BreadcrumbItem[];
	/** Whether current user can moderate this forum */
	canModerateForum: boolean;
	/** Can manage thread (sticky/highlight/digest/close) */
	canManageThread: boolean;
	/** Can move thread to another forum (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can delete thread (SuperMod/Admin or author) */
	canDeleteThread: boolean;
	/** Current user info (for permission checks in client components) */
	currentUser: User | null;
}

export async function loadThreadDetail(params: {
	threadId: number;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<ThreadDetailPageData> {
	// Fetch current user session and posts per page setting
	const [sessionUser, defaultLimit] = await Promise.all([getCurrentForumUser(), getPostsPerPage()]);

	// Parallel fetch: thread + posts + forums
	const [threadRes, postsRes, forumsRes] = await Promise.all([
		forumApi.get<Thread>(`/api/v1/threads/${params.threadId}`),
		forumApi.getCursor<Post>("/api/v1/posts", {
			threadId: params.threadId,
			limit: params.limit ?? defaultLimit,
			cursor: params.cursor,
		}),
		forumApi.getAll<Forum>("/api/v1/forums"),
	]);

	const thread = threadRes.data;
	const forum = forumsRes.data.find((f) => f.id === thread.forumId) ?? null;

	// Build current user object for permission checks
	let currentUser: User | null = null;
	if (sessionUser) {
		currentUser = {
			id: sessionUser.userId,
			username: sessionUser.username,
			role: sessionUser.role as UserRole,
			// Fill in required User fields with defaults (not used for permission checks)
			email: "",
			avatar: "",
			status: UserStatus.Active,
			regDate: 0,
			lastLogin: 0,
			threads: 0,
			posts: 0,
			credits: 0,
			signature: "",
			groupTitle: "",
			groupStars: 0,
			groupColor: "",
			customTitle: "",
			digestPosts: 0,
			olTime: 0,
			lastActivity: 0,
			gender: 0,
			birthYear: 0,
			birthMonth: 0,
			birthDay: 0,
			resideProvince: "",
			resideCity: "",
			graduateSchool: "",
			bio: "",
			interest: "",
			qq: "",
			site: "",
			regIp: "",
			lastIp: "",
		};
	}

	// Check moderation permissions
	const canModerateForum = forum ? canModerate(currentUser, forum) : false;
	const canManage = forum ? canManageThread(currentUser, forum) : false;
	const canMove = canMoveThread(currentUser);
	const canDelete = forum ? canDeleteThread(currentUser, thread, forum) : false;

	// Fetch attachments per post (Worker only supports per-post, not per-thread)
	const attachmentResults = await Promise.all(
		postsRes.data.map((post) =>
			forumApi
				.getAll<Attachment>(`/api/v1/posts/${post.id}/attachments`)
				.then((res) => res.data)
				.catch(() => [] as Attachment[]),
		),
	);
	const allAttachments = attachmentResults.flat();

	// Batch author lookup (deduplicated)
	const authorIds = uniqueAuthorIds(postsRes.data);
	const authorEntries = await Promise.all(
		authorIds.map((id) =>
			forumApi
				.get<PublicUser>(`/api/v1/users/${id}`)
				.then((res) => [id, publicUserToUser(res.data)] as const)
				.catch(() => null),
		),
	);
	const authorMap = new Map<number, User>();
	for (const entry of authorEntries) {
		if (entry) authorMap.set(entry[0], entry[1]);
	}

	// Group attachments by postId and enrich posts
	const attachmentMap = groupAttachmentsByPostId(allAttachments);
	const posts = enrichPosts(
		postsRes.data,
		authorMap,
		attachmentMap,
		currentUser,
		forum ?? { moderators: "" },
	);

	// Build breadcrumbs from forum ancestors
	const ancestors = findForumAncestors(forumsRes.data, thread.forumId);
	const breadcrumbs = buildThreadBreadcrumbs(ancestors, thread.subject);

	return {
		thread,
		forum,
		forums: forumsRes.data,
		posts,
		nextCursor: postsRes.meta.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: postsRes.data.length,
		breadcrumbs,
		canModerateForum,
		canManageThread: canManage,
		canMoveThread: canMove,
		canDeleteThread: canDelete,
		currentUser,
	};
}
