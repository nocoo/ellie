// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls Worker API (GET /api/v1/threads/:id + GET /api/v1/posts + GET /api/v1/forums/:id/ancestors
//   + POST /api/v1/posts/attachments/batch + GET /api/v1/users/batch).

import "server-only";

import {
	type Attachment,
	canEditThreadSubject,
	canManageThread,
	canModerate,
	canMoveThread,
	type Post,
	type PublicUser,
	type Thread,
	type User,
	type UserRole,
	UserStatus,
} from "@ellie/types";
import { ApiError } from "@/lib/api-error";
import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCurrentForumUser, getWorkerJwt } from "@/lib/forum-auth";
import { buildThreadBreadcrumbsFromAncestors } from "@/lib/forum-breadcrumbs";
import {
	getCachedForumAncestors,
	getCachedPostsPerPage,
	getCachedThreadById,
} from "@/lib/forum-cache";
import type { ForumContext } from "@/lib/forum-data";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { fetchPublicSettings, getStr } from "./settings.server";
import {
	buildFallbackAuthorMap,
	type EnrichedPost,
	enrichPosts,
	groupAttachmentsByPostId,
	uniqueAuthorIds,
} from "./thread-detail";

export interface ThreadDetailPageData {
	thread: Thread | null;
	forum: ForumContext | null;
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
	/** Can edit thread subject (author on open thread, or moderator/admin) */
	canEditSubject: boolean;
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
	// Fetch current user session, JWT, and posts per page setting
	const [sessionUser, jwt, defaultLimit] = await Promise.all([
		getCurrentForumUser(),
		getWorkerJwt(),
		getCachedPostsPerPage(),
	]);

	// Thread and posts load in parallel; their forum context uses the ancestor chain.
	// When a JWT is available, use authenticated calls so moderated threads (sticky=-2)
	// resolve for their author / forum mods / staff.
	const [thread, postsRes] = await Promise.all([
		jwt
			? forumApi.getAuth<Thread>(`/api/v1/threads/${params.threadId}`, jwt).then((r) => r.data)
			: getCachedThreadById(params.threadId),
		jwt
			? forumApi.getCursorAuth<Post>("/api/v1/posts", jwt, {
					threadId: params.threadId,
					limit: params.limit ?? defaultLimit,
					cursor: params.cursor,
					last: params.last ? "1" : undefined,
				})
			: forumApi.getCursor<Post>("/api/v1/posts", {
					threadId: params.threadId,
					limit: params.limit ?? defaultLimit,
					cursor: params.cursor,
					last: params.last ? "1" : undefined,
				}),
	]);

	const context = await getCachedForumAncestors(thread.forumId).catch((error: unknown) => {
		if (error instanceof ApiError && error.status === 404) return null;
		throw error;
	});
	const forum = context?.forum ?? null;

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
			campus: "",
			checkin: null,
			purgedAt: 0,
			purgedBy: 0,
		};
	}

	// Check moderation permissions
	const canModerateForum = forum ? canModerate(currentUser, forum) : false;
	const canManage = forum ? canManageThread(currentUser, forum) : false;
	const canMove = canMoveThread(currentUser);
	// Thread delete UI: Admin/SuperMod only — author excluded per user request.
	// Worker/API still accepts author deletes; this only hides the button.
	const canDelete = canMove;
	// Pencil pen entry next to <h1> — author (active + open) OR moderator/admin.
	// Worker enforces the same predicate; this gate only controls visibility.
	const canEditSubject = forum
		? canEditThreadSubject(
				currentUser,
				{ id: thread.id, authorId: thread.authorId, closed: thread.closed },
				forum,
			)
		: false;

	// Fetch attachments and authors in parallel; comments load only when expanded.
	// (eliminates N+1: 1 batch request per resource type instead of N per-post requests).
	//
	// Authors fall back to post.authorName; attachment failures are logged.
	// Comments stay undefined until the reader expands them in the browser.
	const postIds = postsRes.data.map((p) => p.id);
	const authorIds = uniqueAuthorIds(postsRes.data);

	const [batchAttachmentRes, batchAuthorRes] = await Promise.all([
		// Batch attachment fetch: POST /api/v1/posts/attachments/batch
		// No client-side fallback for attachments; log failure but keep the
		// shape stable as `[]` so the post body still renders.
		postIds.length > 0
			? (jwt
					? forumApi.postAuth<Attachment[]>(
							"/api/v1/posts/attachments/batch",
							{ threadId: params.threadId, postIds },
							jwt,
						)
					: forumApi.post<Attachment[]>("/api/v1/posts/attachments/batch", {
							threadId: params.threadId,
							postIds,
						})
				)
					.then((res) => res.data)
					.catch((err) => {
						console.warn(
							"[thread-detail.server] posts/attachments/batch failed (rendering with [])",
							{ threadId: params.threadId, postIds: postIds.length, err },
						);
						return [] as Attachment[];
					})
			: Promise.resolve([] as Attachment[]),
		// Batch author fetch: GET /api/v1/users/batch?ids=1,2,3
		// Failure → `undefined`. enrichPosts then constructs a minimal author
		// stub from `post.authorId` + `post.authorName` so the `<Link href="/users/N">`
		// still renders. We never invent sensitive fields (role, status, etc).
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
						return map as Map<number, User> | undefined;
					})
					.catch((err) => {
						console.warn(
							"[thread-detail.server] users/batch failed (falling back to post.authorName)",
							{ threadId: params.threadId, authorIds: authorIds.length, err },
						);
						return undefined;
					})
			: Promise.resolve(new Map<number, User>()),
	]);

	const allAttachments = batchAttachmentRes;
	const authorMap = batchAuthorRes ?? buildFallbackAuthorMap(postsRes.data);

	const attachmentMap = groupAttachmentsByPostId(allAttachments);
	const posts = enrichPosts(
		postsRes.data,
		authorMap,
		attachmentMap,
		undefined,
		currentUser,
		forum ?? { moderators: "" },
	);

	// Build breadcrumbs from forum ancestors
	const ancestors = context?.ancestors ?? [];
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildThreadBreadcrumbsFromAncestors(
		ancestors,
		thread.forumId,
		forum?.name ?? "版块",
		thread.subject,
		homeLabel,
	);

	return {
		thread,
		forum,
		posts,
		nextCursor: postsRes.meta.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: thread.replies,
		breadcrumbs,
		canModerateForum,
		canManageThread: canManage,
		canMoveThread: canMove,
		canDeleteThread: canDelete,
		canEditSubject,
		currentUser,
	};
}
