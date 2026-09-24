// Fresh forum-list context. Authority and page membership come from D1.
// This route never reads or writes KV.

import {
	type Forum,
	type ForumListContextData,
	type ForumListContextRequest,
	type ForumListDisplay,
	ForumType,
	type ForumVisibility,
	type HomeStats,
	type HomeUser,
	homeForumVisible,
	type ReadingBucket,
} from "@ellie/types";
import { loadCatalogPage, loadThreadTypes, type ThreadTypesPayload } from "./cache/catalog-read";
import { loadPublicStats } from "./cache/public-stats-read";
import {
	countLocalThreads,
	getThreadListPage,
	type ThreadListMember,
} from "./cache/thread-list-read";
import {
	loadThreadAccessBatch,
	loadThreadEntities,
	loadThreadStats,
	projectCurrentThread,
	type ThreadAccess,
} from "./cache/thread-loaders";
import type { Env } from "./env";
import { deriveHomeBucket, selectAllowedForumIds } from "./home-read";
import { enrichThreadsWithUserCache, parseModeratorIds, toThread } from "./mappers";
import { shanghaiTodayStartUnix } from "./shanghaiTime";
import { loadUserMiniProfilesFromDb } from "./user-cache";
import { STICKY_GLOBAL } from "./visibility";

export const FORUM_LIST_AUTHORITY_MAX = 2048;
export const FORUM_LIST_AUTHORITY_LIMIT = FORUM_LIST_AUTHORITY_MAX + 1;
export const FORUM_LIST_ANNOUNCEMENT_MAX = 512;
export const FORUM_LIST_ANNOUNCEMENT_LIMIT = FORUM_LIST_ANNOUNCEMENT_MAX + 1;
export const FORUM_LIST_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

const MAX_TYPES = 256;
const MAX_MODERATORS = 256;
const MAX_MODERATOR_IDS_LENGTH = 2048;

const PROFILE_BATCH = 80;
const EMPTY_TYPES: ThreadTypesPayload = {
	enabled: false,
	required: false,
	listable: false,
	prefix: false,
	types: [],
};

export class ForumListBoundError extends Error {
	constructor(message = "Forum list context exceeds its read bound") {
		super(message);
		this.name = "ForumListBoundError";
	}
}

export class ForumListAccessError extends Error {
	constructor(readonly status: 403 | 404) {
		super(status === 403 ? "Forum is not accessible" : "Forum not found");
	}
}

interface ForumAuthorityRow {
	id: number;
	parent_id: number;
	status: number;
	visibility: ForumVisibility;
	display_order: number;
	type: string;
	moderator_ids: string;
}

interface ForumDisplayRow {
	id: number;
	name: string;
	description: string;
	announcement: string;
	icon: string;
	moderators: string;
	thread_types_enabled: number;
	thread_types_required: number;
	thread_types_listable: number;
	thread_types_prefix: number;
	threads: number;
	posts: number;
}

type ForumRow = ForumAuthorityRow & ForumDisplayRow;

interface AnnouncementRow extends ThreadListMember {
	forum_id: number;
}

interface RecommendedMember {
	id: number;
	recommendedAt: number;
}

interface PageSlice {
	window: ThreadListMember[];
	eligibleAnnouncements: ThreadListMember[];
}

export async function readForumListContext(
	env: Env,
	user: HomeUser | null,
	request: ForumListContextRequest,
): Promise<ForumListContextData> {
	const bucket = deriveHomeBucket(user);
	const forums = await loadBoundedForums(env);
	const allowedIds = selectAllowedForumIds(forums, bucket);
	const allowed = new Set(allowedIds);
	const current = forums.find((row) => row.id === request.forumId);
	if (current?.status !== 1) throw new ForumListAccessError(404);
	if (!allowed.has(current.id)) {
		const activeIds = selectAllowedForumIds(
			forums.map(({ id, parent_id, status }) => ({
				id,
				parent_id,
				status,
				visibility: "public" as const,
			})),
			"anon",
		);
		throw new ForumListAccessError(activeIds.includes(current.id) ? 403 : 404);
	}
	const [data, stats] = await Promise.all([
		assemble(env, user, bucket, request, forums, allowed, current),
		request.includeStats ? loadStats(env) : undefined,
	]);
	if (stats) data.stats = stats;
	return data;
}

async function assemble(
	env: Env,
	user: HomeUser | null,
	bucket: ReadingBucket,
	request: ForumListContextRequest,
	forums: readonly ForumAuthorityRow[],
	allowed: Set<number>,
	current: ForumAuthorityRow,
): Promise<ForumListContextData> {
	const group = current.type === ForumType.Group;
	const [loadedTypes, recommended] = await Promise.all([
		loadThreadTypes(env, current.id, MAX_TYPES + 1),
		group ? [] : loadRecommended(env, current.id),
	]);
	const typeConfig = loadedTypes ?? EMPTY_TYPES;
	if (typeConfig.types.length > MAX_TYPES) throw new ForumListBoundError();
	const typeId = normalizeTypeId(request.typeId, typeConfig);
	const { page, access } = group
		? { page: emptyPage(), access: new Map<number, ThreadAccess>() }
		: await loadVerifiedPage(env, request, typeId, allowed, bucket, recommended);
	const visible = {
		members: page.window.slice(0, request.limit),
		hasNext: page.window.length > request.limit,
	};
	const recommendedFlags = recommended.flatMap((row) => {
		const gate = access.get(row.id);
		return gate &&
			gate.sticky >= 0 &&
			gate.status === 1 &&
			gate.forum_id === current.id &&
			homeForumVisible(gate.visibility as ForumVisibility, bucket)
			? [{ row, gate }]
			: [];
	});
	const revision = await hashRevision({
		query: { forumId: current.id, page: request.page, limit: request.limit, typeId },
		bucket,
		forums: relevantForums(forums, allowed, current.id),
		types: typeConfig,
		page: visible.members.map((row) => pageFlag(row, access.get(row.id) as ThreadAccess)),
		recommended: recommendedFlags.map(({ row, gate }) => ({
			id: row.id,
			anonymousAuthor: gate.anonymous_author === 1 ? 1 : 0,
			authorId: gate.anonymous_author === 1 ? 0 : gate.author_id,
			recommendedAt: row.recommendedAt,
		})),
	});
	const bucketMismatch = request.cachedBucket !== bucket;
	const typeNormalized = request.typeId !== typeId;
	const forceDisplay =
		request.includeDisplay ||
		request.cachedRevision === null ||
		request.cachedRevision !== revision ||
		bucketMismatch ||
		typeNormalized;
	const needCount = request.includeCount || bucketMismatch || typeNormalized;
	const [display, count] = await Promise.all([
		forceDisplay
			? loadDisplay(
					env,
					forums,
					allowed,
					current,
					typeConfig,
					visible.members,
					recommendedFlags,
					access,
				)
			: Promise.resolve(undefined),
		needCount
			? loadCount(env, current.id, typeId, group, page.eligibleAnnouncements.length)
			: undefined,
	]);
	const data: ForumListContextData = {
		bucket,
		user,
		revision,
		page: request.page,
		limit: request.limit,
		typeId,
		hasNext: visible.hasNext,
		announcementCount: page.eligibleAnnouncements.length,
	};
	if (display) data.display = display;
	if (count !== undefined) data.count = count;
	return data;
}

async function loadBoundedForums(env: Env): Promise<ForumAuthorityRow[]> {
	const result = await env.DB.prepare(
		`SELECT id, parent_id, status, visibility, display_order, type,
		        CASE WHEN length(moderator_ids) <= ${MAX_MODERATOR_IDS_LENGTH}
		             THEN moderator_ids ELSE NULL END AS moderator_ids
		 FROM forums
		 ORDER BY id
		 LIMIT ${FORUM_LIST_AUTHORITY_LIMIT}`,
	).all<ForumAuthorityRow>();
	if (!result.success) throw new Error("Forum authority could not be loaded");
	if (
		result.results.length > FORUM_LIST_AUTHORITY_MAX ||
		result.results.some((row) => row.moderator_ids === null)
	)
		throw new ForumListBoundError();
	return result.results;
}

async function loadPage(
	env: Env,
	request: ForumListContextRequest,
	typeId: number | null,
	allowed: Set<number>,
): Promise<PageSlice> {
	const eligibleAnnouncements =
		typeId === null ? await loadEligibleAnnouncements(env, allowed) : [];
	const loaded = await getThreadListPage(
		env,
		undefined,
		{
			forumId: request.forumId,
			limit: request.limit,
			page: request.page,
			cursor: null,
			typeId,
			includeTotal: false,
		},
		true,
		typeId === null ? eligibleAnnouncements : undefined,
	);
	return {
		window: loaded.window,
		eligibleAnnouncements,
	};
}

function emptyPage(): PageSlice {
	return { window: [], eligibleAnnouncements: [] };
}

async function loadEligibleAnnouncements(
	env: Env,
	allowed: Set<number>,
): Promise<ThreadListMember[]> {
	const result = await env.DB.prepare(
		`SELECT t.id, t.sticky, t.last_post_at, t.forum_id
		 FROM threads t
		 JOIN forums f ON f.id = t.forum_id
		 WHERE t.sticky = ${STICKY_GLOBAL} AND f.status = 1
		 ORDER BY t.last_post_at DESC, t.id DESC
		 LIMIT ${FORUM_LIST_ANNOUNCEMENT_LIMIT}`,
	).all<AnnouncementRow>();
	if (!result.success) throw new Error("Announcements could not be loaded");
	if (result.results.length > FORUM_LIST_ANNOUNCEMENT_MAX) throw new ForumListBoundError();
	return result.results
		.filter((row) => row.sticky === STICKY_GLOBAL && allowed.has(row.forum_id))
		.map((row) => ({ id: row.id, sticky: row.sticky, last_post_at: row.last_post_at }));
}

async function loadRecommended(env: Env, forumId: number): Promise<RecommendedMember[]> {
	const page = await loadCatalogPage(env, {
		family: "recommended:threads",
		scope: "internal",
		params: { forumId },
	});
	return page.items.map(({ id, recommendedAt }) => ({ id, recommendedAt: recommendedAt ?? 0 }));
}

async function loadVerifiedPage(
	env: Env,
	request: ForumListContextRequest,
	typeId: number | null,
	allowed: Set<number>,
	bucket: ReadingBucket,
	recommended: readonly RecommendedMember[],
): Promise<{ page: PageSlice; access: Map<number, ThreadAccess> }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const page = await loadPage(env, request, typeId, allowed);
		const access = await loadThreadAccessBatch(env, [
			...page.window.map((row) => row.id),
			...recommended.map((row) => row.id),
		]);
		if (
			page.window.every((row) => {
				const gate = access.get(row.id);
				return (
					gate?.sticky === row.sticky && pageVisible(gate, request.forumId, typeId, allowed, bucket)
				);
			})
		)
			return { page, access };
	}
	throw new ForumListBoundError("Forum list changed during read");
}

function pageVisible(
	row: ThreadAccess | undefined,
	forumId: number,
	typeId: number | null,
	allowed: Set<number>,
	bucket: ReadingBucket,
): boolean {
	if (row == null) return false;
	if (
		row.status !== 1 ||
		row.sticky < 0 ||
		!homeForumVisible(row.visibility as ForumVisibility, bucket)
	)
		return false;
	if (typeId === null && row.sticky === STICKY_GLOBAL) return allowed.has(row.forum_id);
	return row.forum_id === forumId && (typeId === null || row.type_id === typeId);
}

function normalizeTypeId(typeId: number | null, config: ThreadTypesPayload): number | null {
	if (typeId === null || !config.enabled || !config.listable) return null;
	return config.types.some((row) => row.id === typeId) ? typeId : null;
}

async function loadCount(
	env: Env,
	forumId: number,
	typeId: number | null,
	group: boolean,
	eligibleAnnouncements: number,
): Promise<number> {
	if (group) return 0;
	const local = await countLocalThreads(env, forumId, typeId);
	return typeId === null ? eligibleAnnouncements + local : local;
}

async function loadDisplay(
	env: Env,
	forums: readonly ForumAuthorityRow[],
	allowed: Set<number>,
	current: ForumAuthorityRow,
	typeConfig: ThreadTypesPayload,
	members: readonly ThreadListMember[],
	recommended: readonly { row: RecommendedMember; gate: ThreadAccess }[],
	access: Map<number, ThreadAccess>,
): Promise<ForumListDisplay> {
	const relevant = relevantForums(forums, allowed, current.id);
	const topicIds = [
		...new Set([...members.map((row) => row.id), ...recommended.map(({ row }) => row.id)]),
	];
	const [forumDisplay, entities, stats, today, names] = await Promise.all([
		loadForumDisplayRows(
			env,
			relevant.map((row) => row.id),
		),
		loadThreadEntities(env, topicIds),
		loadThreadStats(env, topicIds),
		loadTodayCounts(
			env,
			relevant.map((row) => row.id),
		),
		loadModeratorNames(env, relevant),
	]);
	const topics = topicIds.flatMap((id) => {
		const entity = entities.get(id);
		const stat = stats.get(id);
		const gate = access.get(id);
		return entity && stat && gate
			? [toThread(projectCurrentThread({ ...entity, ...stat }, gate), null)]
			: [];
	});
	const profileIds = [
		...new Set(topics.flatMap((row) => [row.authorId, row.lastPosterId]).filter((id) => id > 0)),
	];
	const profiles = await loadUserMiniProfilesFromDb(env, profileIds);
	const byId = new Map(enrichThreadsWithUserCache(topics, profiles).map((row) => [row.id, row]));
	return {
		forums: relevant
			.slice()
			.sort((a, b) => a.display_order - b.display_order || a.id - b.id)
			.flatMap((row) => {
				const display = forumDisplay.get(row.id);
				return display ? [projectForum({ ...display, ...row }, today.get(row.id) ?? 0, names)] : [];
			}),
		threads: members.flatMap(({ id }) => {
			const thread = byId.get(id);
			return thread ? [thread] : [];
		}),
		threadTypes: typeConfig,
		recommended: recommended.flatMap(({ row }) => {
			const thread = byId.get(row.id);
			return thread
				? [
						{
							id: thread.id,
							subject: thread.subject,
							authorId: thread.authorId,
							authorName: thread.authorName,
							replies: thread.replies,
							lastPostAt: thread.lastPostAt,
							recommendedAt: row.recommendedAt,
						},
					]
				: [];
		}),
	};
}

async function loadForumDisplayRows(
	env: Env,
	ids: number[],
): Promise<Map<number, ForumDisplayRow>> {
	const result = await env.DB.prepare(
		`SELECT id, name, description, announcement, icon, moderators,
		        thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix,
		        threads, posts
		 FROM forums WHERE id IN (SELECT value FROM json_each(?))`,
	)
		.bind(JSON.stringify(ids))
		.all<ForumDisplayRow>();
	if (!result.success) throw new Error("Forum display could not be loaded");
	return new Map(result.results.map((row) => [row.id, row]));
}

function projectForum(row: ForumRow, todayThreads: number, names: Map<number, string>): Forum {
	return {
		id: row.id,
		parentId: row.parent_id,
		name: row.name ?? "",
		description: row.description ?? "",
		announcement: row.announcement ?? "",
		icon: row.icon ?? "",
		displayOrder: row.display_order,
		type: row.type as ForumType,
		status: row.status,
		visibility: row.visibility,
		moderators: row.moderators ?? "",
		moderatorList: parseModeratorIds(row.moderator_ids).flatMap((id) => {
			const name = names.get(id);
			return name ? [{ id, name }] : [];
		}),
		threads: nonnegative(row.threads),
		posts: nonnegative(row.posts),
		todayThreads,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: {
			enabled: row.thread_types_enabled === 1,
			required: row.thread_types_required === 1,
			listable: row.thread_types_listable === 1,
			prefix: row.thread_types_prefix === 1,
		},
	};
}

function relevantForums(
	forums: readonly ForumAuthorityRow[],
	allowed: Set<number>,
	forumId: number,
): ForumAuthorityRow[] {
	const byId = new Map(forums.map((row) => [row.id, row]));
	const ids = new Set<number>();
	const ancestors = new Set<number>();
	let cursor = byId.get(forumId);
	while (cursor && !ancestors.has(cursor.id)) {
		ancestors.add(cursor.id);
		if (allowed.has(cursor.id)) ids.add(cursor.id);
		if (cursor.parent_id === 0 || cursor.parent_id === cursor.id) break;
		cursor = byId.get(cursor.parent_id);
	}
	const children = new Map<number, number[]>();
	for (const row of forums) {
		if (!allowed.has(row.id)) continue;
		const list = children.get(row.parent_id) ?? [];
		list.push(row.id);
		children.set(row.parent_id, list);
	}
	const stack = [forumId];
	const walked = new Set<number>();
	while (stack.length > 0) {
		const id = stack.pop() as number;
		if (walked.has(id)) continue;
		walked.add(id);
		if (allowed.has(id)) ids.add(id);
		for (const child of children.get(id) ?? []) stack.push(child);
	}
	return [...ids].flatMap((id) => {
		const row = byId.get(id);
		return row ? [row] : [];
	});
}

function pageFlag(row: ThreadListMember, gate: ThreadAccess) {
	return {
		id: row.id,
		sticky: gate.sticky,
		lastPostAt: row.last_post_at,
		forumId: gate.forum_id,
		anonymousAuthor: gate.anonymous_author === 1 ? 1 : 0,
		anonymousLastPoster: gate.anonymous_last_poster === 1 ? 1 : 0,
		authorId: gate.anonymous_author === 1 ? 0 : gate.author_id,
		lastPosterId: gate.anonymous_last_poster === 1 ? 0 : gate.last_poster_id,
		status: gate.status,
		visibility: gate.visibility,
	};
}

async function loadTodayCounts(env: Env, ids: readonly number[]): Promise<Map<number, number>> {
	const counts = new Map<number, number>();
	if (ids.length === 0) return counts;
	const result = await env.DB.prepare(
		`SELECT forum_id, COUNT(*) AS cnt
		 FROM threads INDEXED BY idx_threads_created
		 WHERE created_at >= ? AND sticky >= 0
		   AND forum_id IN (SELECT value FROM json_each(?))
		 GROUP BY forum_id`,
	)
		.bind(shanghaiTodayStartUnix(), JSON.stringify(ids))
		.all<{ forum_id: number; cnt: number }>();
	if (!result.success) throw new Error("Forum counters could not be loaded");
	for (const row of result.results) counts.set(row.forum_id, nonnegative(row.cnt));
	return counts;
}

async function loadModeratorNames(
	env: Env,
	forums: readonly ForumAuthorityRow[],
): Promise<Map<number, string>> {
	const unique = new Set<number>();
	for (const row of forums) {
		for (const id of parseModeratorIds(row.moderator_ids)) {
			if (Number.isSafeInteger(id)) unique.add(id);
			if (unique.size > MAX_MODERATORS) throw new ForumListBoundError();
		}
	}
	const ids = [...unique];
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
	return names;
}

async function loadStats(env: Env): Promise<HomeStats | undefined> {
	try {
		return await loadPublicStats(env);
	} catch {
		console.warn("[forum-list-context] Statistics unavailable; omitted from response");
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

function nonnegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
