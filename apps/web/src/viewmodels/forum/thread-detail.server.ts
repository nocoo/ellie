import "server-only";

import {
	canEditThreadSubject,
	canManageThread,
	canModerate,
	canMoveThread,
	type Thread,
	type User,
	type UserRole,
} from "@ellie/types";
import { headers } from "next/headers";
import { publicUserToUser } from "@/lib/forum-api";
import { buildThreadBreadcrumbsFromAncestors } from "@/lib/forum-breadcrumbs";
import { getCachedThreadContext, recordThreadView } from "@/lib/forum-cache";
import type { ForumContext } from "@/lib/forum-data";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { fetchPublicSettings, getStr } from "./settings.server";
import { type EnrichedPost, enrichPosts, groupAttachmentsByPostId } from "./thread-detail";

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

/**
 * Identifiable prefetches must not count (doc/29): the router prefetch
 * header plus standard purpose / sec-purpose hints. A full page request
 * counts exactly once via the request-scoped `recordThreadView`.
 */
async function isPrefetchRender(): Promise<boolean> {
	const headerList = await headers();
	if (headerList.get("x-ellie-prefetch") === "1") return true;
	return [headerList.get("purpose"), headerList.get("sec-purpose")].some((purpose) =>
		purpose
			?.toLowerCase()
			.split(/[\s,;]+/)
			.includes("prefetch"),
	);
}

export async function loadThreadDetail(params: {
	threadId: number;
}): Promise<ThreadDetailPageData> {
	const [context, settings] = await Promise.all([getCachedThreadContext(), fetchPublicSettings()]);
	const { thread, user: sessionUser, display } = context;
	if (thread.id !== params.threadId) throw new Error("Thread context mismatch");
	const { forum, ancestors } = display;

	// Build current user object for permission checks
	let currentUser: User | null = null;
	if (sessionUser) {
		currentUser = {
			id: sessionUser.id,
			username: sessionUser.username,
			role: sessionUser.role as UserRole,
			// Fill in required User fields with defaults (not used for permission checks)
			email: sessionUser.email,
			avatar: "",
			avatarPath: "",
			status: sessionUser.status,
			regDate: 0,
			lastLogin: 0,
			threads: 0,
			posts: 0,
			credits: sessionUser.credits,
			coins: sessionUser.coins,
			signature: "",
			groupTitle: sessionUser.groupTitle,
			groupStars: 0,
			groupColor: "",
			customTitle: "",
			digestPosts: 0,
			olTime: 0,
			lastActivity: 0,
			emailVerifiedAt: sessionUser.emailVerifiedAt,
			emailNormalized: "",
			emailChangedAt: sessionUser.emailChangedAt,
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

	const authorMap = new Map(display.authors.map((author) => [author.id, publicUserToUser(author)]));

	const attachmentMap = groupAttachmentsByPostId(display.attachments);
	const posts = enrichPosts(
		display.posts,
		authorMap,
		attachmentMap,
		undefined,
		currentUser,
		forum ?? { moderators: "" },
	);

	// Build breadcrumbs from forum ancestors
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildThreadBreadcrumbsFromAncestors(
		ancestors,
		thread.forumId,
		forum?.name ?? "版块",
		thread.subject,
		homeLabel,
	);

	// Successful page boundary (doc/29): thread, posts, context, attachments
	// and authors all resolved. Count exactly one view per request — the
	// runtime buffers the increment and the UI shows this request's returned
	// base + 1. Identifiable prefetches and pending-review reads (sticky < 0)
	// do not count.
	const counted = thread.sticky >= 0 && !(await isPrefetchRender());
	if (counted) {
		recordThreadView(thread.id);
	}
	const displayThread = counted ? { ...thread, views: thread.views + 1 } : thread;

	return {
		thread: displayThread,
		forum,
		posts,
		nextCursor: context.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: displayThread.replies,
		breadcrumbs,
		canModerateForum,
		canManageThread: canManage,
		canMoveThread: canMove,
		canDeleteThread: canDelete,
		canEditSubject,
		currentUser,
	};
}
