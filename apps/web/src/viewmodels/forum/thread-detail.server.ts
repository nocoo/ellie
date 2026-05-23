// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls Worker API (GET /api/v1/threads/:id + GET /api/v1/posts + GET /api/v1/forums
//   + POST /api/v1/posts/attachments/batch + GET /api/v1/users/batch).

import "server-only";

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import { getCurrentForumUser, getWorkerJwt } from "@/lib/forum-auth";
import { buildThreadBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getCachedForumList, getCachedThreadById } from "@/lib/forum-cache";
import { getCachedPostsPerPage } from "@/lib/forum-cache";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import {
	type Attachment,
	type Forum,
	type Post,
	type PostComment,
	type PublicUser,
	type Thread,
	type User,
	type UserRole,
	UserStatus,
	canEditThreadSubject,
	canManageThread,
	canModerate,
	canMoveThread,
	findForumAncestors,
} from "@ellie/types";
import { fetchPublicSettings, getStr } from "./settings.server";
import {
	type EnrichedPost,
	buildFallbackAuthorMap,
	enrichPosts,
	groupAttachmentsByPostId,
	groupCommentsByPostId,
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

	// Parallel fetch: thread + posts + forums (thread & forums deduped via React cache)
	// When a JWT is available, use authenticated calls so moderated threads (sticky=-2)
	// resolve for their author / forum mods / staff.
	const [thread, postsRes, forums] = await Promise.all([
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
		getCachedForumList(),
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

	// Fetch attachments, comments, and authors in parallel using batch endpoints
	// (eliminates N+1: 1 batch request per resource type instead of N per-post requests).
	//
	// Failure semantics (rev — see L3 e2e investigation):
	// SSR must NOT silently swallow batch failures into empty data, otherwise
	// downstream UI (post-comments, author link) renders permanently empty even
	// though the worker is reachable from the browser. Each branch logs the
	// error and returns a sentinel that downstream code can distinguish from
	// "successfully empty":
	//   - comments: `undefined`  → PostComments falls back to its own client fetch
	//   - authors:  `undefined`  → enrichPosts uses post.authorName for a minimal author shape
	//   - attachments: `[]`      → no client fallback exists today; log only
	//
	// Logging level: use `console.warn`, NOT `console.error`. Next.js dev
	// mode renders every server-side `console.error` as a full-screen
	// "Console Error" overlay, which collides with Playwright `[role="dialog"]`
	// selectors used by L3 specs (see tests/e2e/post-crud.spec.ts strict-mode
	// failure when `replyDialog` matched the dev overlay alongside the real
	// reply dialog). The fallback succeeding is expected operational behavior
	// when the deployed test worker is stale, not a programmer error — `warn`
	// gives the same observability without triggering the dev-overlay UX.
	const postIds = postsRes.data.map((p) => p.id);
	const authorIds = uniqueAuthorIds(postsRes.data);

	const [batchAttachmentRes, batchCommentRes, batchAuthorRes] = await Promise.all([
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
		// Batch comment fetch: POST /api/v1/post-comments/batch
		// Failure → `undefined` so PostComments triggers a client-side refetch
		// instead of hard-rendering an empty list.
		postIds.length > 0
			? (jwt
					? forumApi.postAuth<PostComment[]>(
							"/api/v1/post-comments/batch",
							{ threadId: params.threadId, postIds },
							jwt,
						)
					: forumApi.post<PostComment[]>("/api/v1/post-comments/batch", {
							threadId: params.threadId,
							postIds,
						})
				)
					.then((res) => res.data as PostComment[] | undefined)
					.catch((err) => {
						console.warn(
							"[thread-detail.server] post-comments/batch failed (client will refetch)",
							{ threadId: params.threadId, postIds: postIds.length, err },
						);
						return undefined;
					})
			: Promise.resolve([] as PostComment[]),
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
	const allComments = batchCommentRes;
	const authorMap = batchAuthorRes ?? buildFallbackAuthorMap(postsRes.data);

	// Group attachments and comments by postId and enrich posts.
	// `commentMap === undefined` propagates SSR batch failure into
	// `EnrichedPost.comments === undefined`; PostComments treats that as
	// "fetch on the client" rather than "no comments exist".
	const attachmentMap = groupAttachmentsByPostId(allAttachments);
	const commentMap = allComments === undefined ? undefined : groupCommentsByPostId(allComments);
	const posts = enrichPosts(
		postsRes.data,
		authorMap,
		attachmentMap,
		commentMap,
		currentUser,
		forum ?? { moderators: "" },
	);

	// Build breadcrumbs from forum ancestors
	const ancestors = findForumAncestors(forums, thread.forumId);
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildThreadBreadcrumbs(ancestors, thread.subject, homeLabel);

	return {
		thread,
		forum,
		forums,
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
