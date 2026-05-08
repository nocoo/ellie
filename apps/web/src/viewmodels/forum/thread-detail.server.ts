// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls Worker API (GET /api/v1/threads/:id + GET /api/v1/posts + GET /api/v1/forums
//   + POST /api/v1/posts/attachments/batch + GET /api/v1/users/batch).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { buildThreadBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getForumList, getThreadById } from "@/lib/forum-data";
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
	last?: boolean;
}): Promise<ThreadDetailPageData> {
	// Fetch current user session and posts per page setting
	const [sessionUser, defaultLimit] = await Promise.all([getCurrentForumUser(), getPostsPerPage()]);

	// Parallel fetch: thread + posts + forums (thread & forums deduped via React cache)
	const [thread, postsRes, forums] = await Promise.all([
		getThreadById(params.threadId),
		forumApi.getCursor<Post>("/api/v1/posts", {
			threadId: params.threadId,
			limit: params.limit ?? defaultLimit,
			cursor: params.cursor,
			last: params.last ? "1" : undefined,
		}),
		getForumList(),
	]);

	const forum = forums.find((f) => f.id === thread.forumId) ?? null;

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
			avatarPath: "",
			status: UserStatus.Active,
			regDate: 0,
			lastLogin: 0,
			threads: 0,
			posts: 0,
			credits: 0,
			coins: 0,
			signature: "",
			groupTitle: "",
			groupStars: 0,
			groupColor: "",
			customTitle: "",
			digestPosts: 0,
			olTime: 0,
			lastActivity: 0,
			emailVerifiedAt: 0,
			emailNormalized: "",
			emailChangedAt: 0,
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
			purgedAt: 0,
			purgedBy: 0,
		};
	}

	// Check moderation permissions
	const canModerateForum = forum ? canModerate(currentUser, forum) : false;
	const canManage = forum ? canManageThread(currentUser, forum) : false;
	const canMove = canMoveThread(currentUser);
	const canDelete = forum ? canDeleteThread(currentUser, thread, forum) : false;

	// Fetch attachments and authors in parallel using batch endpoints
	// (eliminates N+1: 1 batch request instead of N per-post attachment requests,
	//  and 1 batch request instead of M per-author user requests)
	const postIds = postsRes.data.map((p) => p.id);
	const authorIds = uniqueAuthorIds(postsRes.data);

	const [batchAttachmentRes, batchAuthorRes] = await Promise.all([
		// Batch attachment fetch: POST /api/v1/posts/attachments/batch
		postIds.length > 0
			? forumApi
					.post<Attachment[]>("/api/v1/posts/attachments/batch", {
						threadId: params.threadId,
						postIds,
					})
					.then((res) => res.data)
					.catch(() => [] as Attachment[])
			: Promise.resolve([] as Attachment[]),
		// Batch author fetch: GET /api/v1/users/batch?ids=1,2,3
		authorIds.length > 0
			? forumApi
					.getAll<PublicUser>("/api/v1/users/batch", {
						ids: authorIds.join(","),
					})
					.then((res) => {
						const map = new Map<number, User>();
						for (const pu of res.data) {
							map.set(pu.id, publicUserToUser(pu));
						}
						return map;
					})
					.catch(() => new Map<number, User>())
			: Promise.resolve(new Map<number, User>()),
	]);

	const allAttachments = batchAttachmentRes;
	const authorMap = batchAuthorRes;

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
	const ancestors = findForumAncestors(forums, thread.forumId);
	const breadcrumbs = buildThreadBreadcrumbs(ancestors, thread.subject);

	return {
		thread,
		forum,
		forums,
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
