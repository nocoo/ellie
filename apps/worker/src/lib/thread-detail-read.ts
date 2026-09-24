// Fresh thread-detail context. Authority and page membership come from D1.
// This route never reads or writes KV.

import {
	decodeThreadDetailCursor,
	EMPTY_RATING_AGGREGATE,
	encodeGenericCursor,
	type ForumVisibility,
	type HomeStats,
	type HomeUser,
	homeForumVisible,
	type ReadingBucket,
	type ThreadDetailContextData,
	type ThreadDetailContextRequest,
	type ThreadDetailDisplay,
	type ThreadForumContext,
	threadDetailSelection,
	UserRole,
} from "@ellie/types";
import { loadPublicStats } from "./cache/public-stats-read";
import {
	loadPostAccessBatch,
	loadPostAttachments,
	loadPostEntities,
	loadPostPage,
	loadRatingAggregates,
	loadThreadAccess,
	loadThreadEntities,
	loadThreadStats,
	type PostAccess,
	type PostPageMember,
	projectCurrentThread,
	type ThreadAccess,
	threadAccessStatus,
} from "./cache/thread-loaders";
import { loadPublicUsersDirect } from "./cache/user-read";
import type { Env } from "./env";
import { deriveHomeBucket } from "./home-read";
import {
	parseModeratorIds,
	projectPublicAttachment,
	shouldUnmaskAnonymous,
	toPost,
	toThread,
	type ViewerContext,
} from "./mappers";
import { STICKY_MODERATED } from "./visibility";

const CHAIN_MAX = 32;
const MODERATOR_IDS_MAX = 2048;
const MODERATOR_MAX = 256;
const PROFILE_BATCH = 80;

export class ThreadDetailAccessError extends Error {
	constructor(readonly status: 403 | 404) {
		super(status === 403 ? "Thread is not accessible" : "Thread not found");
	}
}

export class ThreadDetailBoundError extends Error {
	constructor(message = "Thread context exceeds its read bound") {
		super(message);
		this.name = "ThreadDetailBoundError";
	}
}

interface ForumNode {
	id: number;
	parentId: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
	type: string;
	moderators: string;
	moderatorIds: string;
}

interface PageGate {
	id: number;
	position: number;
	anonymous: 0 | 1;
	authorId: number;
}

export async function readThreadDetailContext(
	env: Env,
	user: HomeUser | null,
	request: ThreadDetailContextRequest,
): Promise<ThreadDetailContextData> {
	const viewer = user ? { userId: user.id, role: user.role } : null;
	const cursorPosition = request.cursor === null ? null : decodeThreadDetailCursor(request.cursor);
	const [access, stats] = await Promise.all([
		loadThreadAccess(env, request.threadId),
		request.includeStats ? loadStats(env) : undefined,
	]);
	const status = threadAccessStatus(access, viewer);
	if (status === 404 || !access) throw new ThreadDetailAccessError(404);
	if (status === 403) throw new ThreadDetailAccessError(403);
	const [forums, entity, threadStats, membership] = await Promise.all([
		loadChain(env, access.forum_id),
		loadThreadEntities(env, [access.id]),
		loadThreadStats(env, [access.id]),
		loadMembership(env, access.id, request.limit, cursorPosition, request.last),
	]);
	const row = entity.get(access.id);
	const counters = threadStats.get(access.id);
	if (!row || !counters) throw new ThreadDetailAccessError(404);
	const thread = toThread(projectCurrentThread({ ...row, ...counters }, access), viewer);
	if (access.sticky === STICKY_MODERATED) thread.moderationStatus = "pending_review";

	const publicChain = acceptedChain(forums, access.forum_id, "anon");
	const viewerChain = acceptedChain(forums, access.forum_id, deriveHomeBucket(user));
	const page = membership.page;
	const publicIds = page.flatMap((item) => (item.authorId > 0 ? [item.authorId] : []));
	const statuses = await loadAuthorStatus(env, publicIds);
	const revision = await hashRevision({
		selection: threadDetailSelection(request.threadId, request.limit, cursorPosition, request.last),
		forumId: access.forum_id,
		page: page.map((item) => ({
			id: item.id,
			position: item.position,
			anonymous: item.anonymous,
			authorId: item.authorId,
		})),
		authors: [...new Set(publicIds)]
			.sort((a, b) => a - b)
			.map((id) => ({ id, status: statuses.get(id) ?? null })),
		forum: publicChain.map(forumShape),
	});
	const pageGates = new Map(
		page.flatMap((item) => {
			const gate = membership.gates.get(item.id);
			return gate ? [[item.id, gate] as const] : [];
		}),
	);
	const cacheable =
		!isStaff(user) &&
		threadAccessStatus(access, null) === null &&
		access.sticky !== STICKY_MODERATED &&
		!revealsAnonymous(viewer, access, pageGates) &&
		sameChain(publicChain, viewerChain);
	const forceDisplay = request.includeDisplay || request.cachedRevision !== revision || !cacheable;
	const data: ThreadDetailContextData = {
		thread,
		user,
		revision,
		cacheable,
		nextCursor: membership.nextCursor,
	};
	if (stats) data.stats = stats;
	if (!forceDisplay) return data;
	data.display = await loadDisplay(
		env,
		access,
		cacheable ? null : viewer,
		page,
		membership.gates,
		cacheable ? publicChain : viewerChain,
		statuses,
	);
	return data;
}

function isStaff(user: HomeUser | null): boolean {
	return (
		user?.role === UserRole.Admin || user?.role === UserRole.SuperMod || user?.role === UserRole.Mod
	);
}

function revealsAnonymous(
	viewer: ViewerContext | null,
	access: ThreadAccess,
	gates: Map<number, PostAccess>,
): boolean {
	if (access.anonymous_author === 1 && shouldUnmaskAnonymous(access.author_id, viewer)) return true;
	if (access.anonymous_last_poster === 1 && shouldUnmaskAnonymous(access.last_poster_id, viewer)) {
		return true;
	}
	for (const gate of gates.values()) {
		if (gate.anonymous === 1 && shouldUnmaskAnonymous(gate.author_id, viewer)) return true;
	}
	return false;
}

function sameChain(left: readonly ForumNode[], right: readonly ForumNode[]): boolean {
	return left.length === right.length && left.every((node, index) => node.id === right[index]?.id);
}

async function loadMembership(
	env: Env,
	threadId: number,
	limit: number,
	cursorPosition: number | null,
	last: boolean,
): Promise<{ page: PageGate[]; gates: Map<number, PostAccess>; nextCursor: string | null }> {
	const query = {
		threadId,
		limit: last ? limit : limit + 1,
		cursorPosition: last ? null : cursorPosition,
		last,
	};
	let members = await loadPostPage(env, query);
	let gates = await loadPostAccessBatch(
		env,
		members.map((item) => item.id),
		threadId,
	);
	if (members.some((item) => !gates.has(item.id))) {
		members = await loadPostPage(env, query);
		gates = await loadPostAccessBatch(
			env,
			members.map((item) => item.id),
			threadId,
		);
	}
	if (members.some((item) => !gates.has(item.id))) throw new ThreadDetailBoundError();
	const page = last ? members : members.slice(0, limit);
	const nextCursor =
		!last && members.length > limit && page.length > 0
			? encodeGenericCursor({ position: page[page.length - 1]?.position ?? 0 })
			: null;
	return {
		page: page.map((item) => toPageGate(item, gates.get(item.id) as PostAccess)),
		gates,
		nextCursor,
	};
}

async function loadCurrentPosts(
	env: Env,
	ids: number[],
	threadId: number,
): Promise<Map<number, Record<string, unknown> | null>> {
	let rows = await loadPostEntities(env, ids, threadId);
	if (ids.some((id) => !rows.get(id))) rows = await loadPostEntities(env, ids, threadId);
	if (ids.some((id) => !rows.get(id))) throw new ThreadDetailBoundError();
	return rows;
}

function toPageGate(member: PostPageMember, gate: PostAccess): PageGate {
	const anonymous = gate.anonymous === 1 ? 1 : 0;
	return {
		id: member.id,
		position: member.position,
		anonymous,
		authorId: anonymous === 1 ? 0 : gate.author_id,
	};
}

async function loadChain(env: Env, forumId: number): Promise<Map<number, ForumNode>> {
	const result = await env.DB.prepare(
		`WITH RECURSIVE chain(id) AS (
			SELECT id FROM forums WHERE id = ?
			UNION
			SELECT f.parent_id FROM forums f
			JOIN chain c ON f.id = c.id
			WHERE f.parent_id > 0 AND f.parent_id != f.id
			LIMIT ${CHAIN_MAX + 1}
		)
		SELECT id, parent_id, name, type, status, visibility, moderators,
			CASE WHEN length(moderator_ids) <= ${MODERATOR_IDS_MAX}
				THEN moderator_ids ELSE NULL END AS moderator_ids
		FROM forums WHERE id IN (SELECT id FROM chain)`,
	)
		.bind(forumId)
		.all<ForumNode & { parent_id: number; moderator_ids: string | null }>();
	if (!result.success) throw new Error("Forum chain could not be loaded");
	if (
		result.results.length > CHAIN_MAX ||
		result.results.some((row) => row.moderator_ids === null)
	) {
		throw new ThreadDetailBoundError();
	}
	return new Map(
		result.results.map((row) => [
			row.id,
			{
				id: row.id,
				parentId: row.parent_id,
				name: row.name,
				status: row.status,
				visibility: row.visibility,
				type: row.type,
				moderators: row.moderators,
				moderatorIds: row.moderator_ids ?? "",
			},
		]),
	);
}

function acceptedChain(
	forums: Map<number, ForumNode>,
	startId: number,
	bucket: ReadingBucket,
): ForumNode[] {
	const upward: ForumNode[] = [];
	const seen = new Set<number>();
	let id = startId;
	while (id > 0) {
		if (seen.has(id) || upward.length >= CHAIN_MAX) throw new ThreadDetailBoundError();
		seen.add(id);
		const node = forums.get(id);
		if (node?.status !== 1 || !homeForumVisible(node.visibility, bucket)) return [];
		upward.push(node);
		if (node.parentId === node.id) throw new ThreadDetailBoundError();
		if (node.parentId === 0) break;
		id = node.parentId;
	}
	return upward.reverse();
}

function forumShape(node: ForumNode): {
	id: number;
	parentId: number;
	type: string;
	status: number;
	visibility: ForumVisibility;
	moderators: string;
	moderatorIds: string;
} {
	return {
		id: node.id,
		parentId: node.parentId,
		type: node.type,
		status: node.status,
		visibility: node.visibility,
		moderators: node.moderators,
		moderatorIds: parseModeratorIds(node.moderatorIds)
			.sort((a, b) => a - b)
			.join(","),
	};
}

async function loadAuthorStatus(env: Env, ids: readonly number[]): Promise<Map<number, number>> {
	const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
	const statuses = new Map<number, number>();
	for (let start = 0; start < unique.length; start += PROFILE_BATCH) {
		const part = unique.slice(start, start + PROFILE_BATCH);
		const result = await env.DB.prepare(
			`SELECT id, status FROM users WHERE id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<{ id: number; status: number }>();
		if (!result.success) throw new Error("Author status could not be loaded");
		for (const row of result.results) statuses.set(row.id, row.status);
	}
	return statuses;
}

async function loadDisplay(
	env: Env,
	access: ThreadAccess,
	displayViewer: ViewerContext | null,
	page: readonly PageGate[],
	gates: Map<number, PostAccess>,
	chain: readonly ForumNode[],
	knownStatus: Map<number, number>,
): Promise<ThreadDetailDisplay> {
	const ids = page.map((item) => item.id);
	const [rows, ratings, attachmentRows, forum] = await Promise.all([
		loadCurrentPosts(env, ids, access.id),
		loadRatingAggregates(env, ids),
		loadPostAttachments(env, ids, access.id),
		forumContext(env, chain),
	]);
	let posts = page.map((item) => {
		const row = rows.get(item.id);
		const gate = gates.get(item.id);
		if (!row || !gate) throw new ThreadDetailBoundError();
		return toPost(
			{ ...row, ...gate, forum_id: access.forum_id },
			ratings.get(item.id) ?? EMPTY_RATING_AGGREGATE,
			displayViewer,
		);
	});
	const authorIds = posts.flatMap((post) => (post.authorId > 0 ? [post.authorId] : []));
	const extra = authorIds.filter((id) => !knownStatus.has(id));
	const extraStatus =
		extra.length > 0 ? await loadAuthorStatus(env, extra) : new Map<number, number>();
	const statuses = new Map([...knownStatus, ...extraStatus]);
	const profiles = await loadPublicUsersDirect(
		env,
		authorIds.filter((id) => (statuses.get(id) ?? -1) >= 0),
	);
	posts = posts.map((post) => ({
		...post,
		authorName: profiles.get(post.authorId)?.username ?? post.authorName,
	}));
	const attachments = [...attachmentRows.values()]
		.flat()
		.sort((a, b) => Number(a.post_id) - Number(b.post_id) || Number(a.id) - Number(b.id))
		.map((row) => {
			const post = posts.find((item) => item.id === Number(row.post_id));
			const masked = !post || (post.anonymous === 1 && post.authorId === 0);
			return projectPublicAttachment(row, masked);
		});
	return {
		posts,
		authors: [...profiles.values()].sort((a, b) => a.id - b.id),
		attachments,
		forum,
		ancestors: chain.slice(0, -1).map((node) => ({
			id: node.id,
			parentId: node.parentId,
			name: node.name,
		})),
	};
}

async function forumContext(
	env: Env,
	chain: readonly ForumNode[],
): Promise<ThreadForumContext | null> {
	const forum = chain[chain.length - 1];
	if (!forum) return null;
	const ids = parseModeratorIds(forum.moderatorIds);
	if (ids.length > MODERATOR_MAX) throw new ThreadDetailBoundError();
	const names = new Map<number, string>();
	for (let start = 0; start < ids.length; start += PROFILE_BATCH) {
		const part = ids.slice(start, start + PROFILE_BATCH);
		const result = await env.DB.prepare(
			`SELECT id, username FROM users WHERE id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<{ id: number; username: string }>();
		if (!result.success) throw new Error("Forum moderators could not be loaded");
		for (const row of result.results) names.set(row.id, row.username);
	}
	return {
		id: forum.id,
		parentId: forum.parentId,
		name: forum.name,
		status: forum.status,
		visibility: forum.visibility,
		type: forum.type,
		moderators: forum.moderators,
		moderatorIds: forum.moderatorIds,
		moderatorList: ids.flatMap((id) => {
			const name = names.get(id);
			return name ? [{ id, name }] : [];
		}),
	};
}

async function loadStats(env: Env): Promise<HomeStats | undefined> {
	try {
		return await loadPublicStats(env);
	} catch {
		console.warn("[thread-context] Statistics unavailable; omitted from response");
		return undefined;
	}
}

async function hashRevision(value: unknown): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(value)),
	);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
