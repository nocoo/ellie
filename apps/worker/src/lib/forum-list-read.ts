import {
	type DailyForumStatistics,
	EMPTY_HOME_STATS,
	type Forum,
	type ForumListContextData,
	type ForumListContextRequest,
	type ForumListDisplay,
	ForumType,
	type ForumVisibility,
	type HomeUser,
	homeForumVisible,
	type ReadingBucket,
} from "@ellie/types";
import { loadCatalogPage, loadThreadTypes, type ThreadTypesPayload } from "./cache/catalog-read";
import { getThreadListPage, type ThreadListMember } from "./cache/thread-list-read";
import {
	loadThreadAccessBatch,
	loadThreadEntities,
	loadThreadStats,
	projectCurrentThread,
	type ThreadAccess,
} from "./cache/thread-loaders";
import { readDailyStatistics } from "./daily-statistics";
import type { Env } from "./env";
import { deriveHomeBucket, selectAllowedForumIds } from "./home-read";
import { enrichThreadsWithUserCache, parseModeratorIds, toThread } from "./mappers";
import {
	decodeForumReadSnapshot,
	encodeForumReadSnapshot,
	isReadingConfig,
	isReadingMembership,
	isReadingRecommendations,
	persistReadingSnapshot,
	READING_CONFIG_TTL_MS,
	READING_HOT_PAGES,
	READING_MEMBERSHIP_TTL_MS,
	READING_RECOMMENDED_TTL_MS,
	type ReadingConfig,
	type ReadingMembership,
	restoreReadingSnapshot,
} from "./reading-snapshots";
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
	const cached = await decodeForumReadSnapshot(env, request.cachedRead, request.forumId, bucket);
	const configKey = `reading:v1:config:${request.forumId}:${bucket}`;
	let config = await restoreReadingSnapshot(
		env,
		configKey,
		READING_CONFIG_TTL_MS,
		isReadingConfig,
		cached?.config,
	);
	let forums: ForumAuthorityRow[] | undefined;
	if (!config) {
		forums = await loadBoundedForums(env);
		const { current, allowed } = authorizeForums(forums, request.forumId, bucket);
		config = await persistReadingSnapshot(
			env,
			configKey,
			READING_CONFIG_TTL_MS,
			await loadConfiguration(env, forums, allowed, current),
		);
	}
	const typeId = normalizeTypeId(request.typeId, config.data.threadTypes);
	const group =
		config.data.forums.find((row) => row.id === request.forumId)?.type === ForumType.Group;
	const recommendedKey = `reading:v1:recommended:${request.forumId}`;
	const pageKey = `reading:v1:page:${request.forumId}:${bucket}:${typeId ?? "all"}:${request.limit}:${request.page}`;
	const cachePage = !group && request.page <= READING_HOT_PAGES;
	const [savedRecommended, savedPage] = await Promise.all([
		group
			? null
			: restoreReadingSnapshot(
					env,
					recommendedKey,
					READING_RECOMMENDED_TTL_MS,
					isReadingRecommendations,
					cached?.recommended,
				),
		cachePage
			? restoreReadingSnapshot(
					env,
					pageKey,
					READING_MEMBERSHIP_TTL_MS,
					(value): value is ReadingMembership =>
						isReadingMembership(value) &&
						value.page === request.page &&
						value.limit === request.limit &&
						value.typeId === typeId,
					cached?.page,
				)
			: null,
	]);
	const announcements =
		group || typeId !== null
			? []
			: (savedPage?.data.announcements ?? (await loadAnnouncements(env)));
	forums ??= await loadScopedForums(env, [
		request.forumId,
		...config.data.forums.map((row) => row.id),
		...announcements.map((row) => row.forum_id),
	]);
	const { current, allowed } = authorizeForums(forums, request.forumId, bucket);
	const eligibleAnnouncements = announcements.filter((row) => allowed.has(row.forum_id));
	const recommended =
		savedRecommended ??
		(group
			? { createdAt: Date.now(), data: [] }
			: await persistReadingSnapshot(
					env,
					recommendedKey,
					READING_RECOMMENDED_TTL_MS,
					await loadRecommended(env, current.id),
				));
	let page = savedPage;
	if (!page && current.type !== ForumType.Group) {
		const loaded = await loadPage(env, request, typeId, eligibleAnnouncements);
		const data: ReadingMembership = {
			page: request.page,
			limit: request.limit,
			typeId,
			window: loaded.window,
			announcements: eligibleAnnouncements,
		};
		page = cachePage
			? await persistReadingSnapshot(env, pageKey, READING_MEMBERSHIP_TTL_MS, data)
			: { createdAt: Date.now(), data };
	}
	const access = await loadThreadAccessBatch(env, [
		...(page?.data.window ?? []).map((row) => row.id),
		...recommended.data.map((row) => row.id),
	]);
	const window = visiblePageMembers(
		page?.data.window ?? [],
		access,
		current,
		typeId,
		allowed,
		bucket,
	);
	const visible = {
		members: window.slice(0, request.limit),
		hasNext: window.length > request.limit,
	};
	const recommendedFlags = visibleRecommended(recommended.data, access, current, bucket);
	const revision = await hashRevision({
		query: { forumId: current.id, page: request.page, limit: request.limit, typeId },
		bucket,
		forums: relevantForums(forums, allowed, current.id),
		configurationTime: config.createdAt,
		types: config.data.threadTypes,
		page: visible.members.map((row) => pageFlag(row, access.get(row.id) as ThreadAccess)),
		recommended: recommendedFlags.map(({ row, gate }) => ({
			id: row.id,
			anonymousAuthor: gate.anonymous_author === 1 ? 1 : 0,
			authorId: gate.anonymous_author === 1 ? 0 : gate.author_id,
			recommendedAt: row.recommendedAt,
		})),
	});
	const forceDisplay =
		request.includeDisplay ||
		request.cachedRevision !== revision ||
		request.cachedBucket !== bucket ||
		request.typeId !== typeId;
	const [display, statistics, readSnapshot] = await Promise.all([
		forceDisplay
			? loadDisplay(
					env,
					forums,
					allowed,
					current,
					config.data,
					visible.members,
					recommendedFlags,
					access,
				)
			: undefined,
		request.includeStats || request.includeCount ? readDailyStatistics(env) : undefined,
		encodeForumReadSnapshot(env, {
			forumId: current.id,
			bucket,
			config: {
				...config,
				data: { ...config.data, forums: config.data.forums.filter((row) => allowed.has(row.id)) },
			},
			recommended: { ...recommended, data: recommendedFlags.map(({ row }) => row) },
			page:
				cachePage && page
					? { ...page, data: { ...page.data, window, announcements: eligibleAnnouncements } }
					: null,
		}),
	]);
	const data: ForumListContextData = {
		bucket,
		user,
		revision,
		page: request.page,
		limit: request.limit,
		typeId,
		hasNext: visible.hasNext,
		announcementCount: eligibleAnnouncements.length,
		readSnapshot,
		display,
	};
	if (request.includeStats) data.stats = statistics?.stats ?? { ...EMPTY_HOME_STATS };
	if (request.includeCount)
		data.count = estimateThreadCount(
			statistics?.forums[current.id],
			typeId,
			eligibleAnnouncements.length,
			current.type === ForumType.Group,
		);
	return data;
}

function visiblePageMembers(
	members: readonly ThreadListMember[],
	access: Map<number, ThreadAccess>,
	current: ForumAuthorityRow,
	typeId: number | null,
	allowed: Set<number>,
	bucket: ReadingBucket,
): ThreadListMember[] {
	if (current.type === ForumType.Group) return [];
	return members.flatMap((row) => {
		const gate = access.get(row.id);
		return gate && pageVisible(gate, current.id, typeId, allowed, bucket)
			? [{ ...row, sticky: gate.sticky }]
			: [];
	});
}

function visibleRecommended(
	members: readonly RecommendedMember[],
	access: Map<number, ThreadAccess>,
	current: ForumAuthorityRow,
	bucket: ReadingBucket,
): { row: RecommendedMember; gate: ThreadAccess }[] {
	if (current.type === ForumType.Group) return [];
	return members.flatMap((row) => {
		const gate = access.get(row.id);
		return gate &&
			gate.sticky >= 0 &&
			gate.status === 1 &&
			gate.forum_id === current.id &&
			homeForumVisible(gate.visibility as ForumVisibility, bucket)
			? [{ row, gate }]
			: [];
	});
}

function estimateThreadCount(
	forum: DailyForumStatistics | undefined,
	typeId: number | null,
	announcements: number,
	group: boolean,
): number {
	if (group) return 0;
	if (typeId !== null) return forum?.types[typeId] ?? 0;
	return Math.min(Number.MAX_SAFE_INTEGER, (forum?.threads ?? 0) + announcements);
}

function authorizeForums(
	forums: readonly ForumAuthorityRow[],
	forumId: number,
	bucket: ReadingBucket,
) {
	const current = forums.find((row) => row.id === forumId);
	if (current?.status !== 1) throw new ForumListAccessError(404);
	const allowed = new Set(selectAllowedForumIds(forums, bucket));
	if (!allowed.has(current.id)) {
		const active = selectAllowedForumIds(
			forums.map((row) => ({ ...row, visibility: "public" as const })),
			"anon",
		);
		throw new ForumListAccessError(active.includes(current.id) ? 403 : 404);
	}
	return { current, allowed };
}

async function loadConfiguration(
	env: Env,
	forums: readonly ForumAuthorityRow[],
	allowed: Set<number>,
	current: ForumAuthorityRow,
): Promise<ReadingConfig> {
	const relevant = relevantForums(forums, allowed, current.id);
	const [display, names, loadedTypes] = await Promise.all([
		loadForumDisplayRows(
			env,
			relevant.map((row) => row.id),
		),
		loadModeratorNames(env, relevant),
		loadThreadTypes(env, current.id, MAX_TYPES + 1),
	]);
	const threadTypes = loadedTypes ?? EMPTY_TYPES;
	if (threadTypes.types.length > MAX_TYPES) throw new ForumListBoundError();
	return {
		forums: relevant.flatMap((row) => {
			const text = display.get(row.id);
			return text ? [projectForum({ ...text, ...row }, 0, names)] : [];
		}),
		threadTypes,
	};
}

async function loadScopedForums(env: Env, ids: number[]): Promise<ForumAuthorityRow[]> {
	const result = await env.DB.prepare(`WITH RECURSIVE authority AS (
		SELECT id, parent_id, status, visibility, display_order, type,
			CASE WHEN length(moderator_ids) <= ${MAX_MODERATOR_IDS_LENGTH} THEN moderator_ids ELSE NULL END AS moderator_ids
		FROM forums WHERE id IN (SELECT value FROM json_each(?))
		UNION
		SELECT f.id, f.parent_id, f.status, f.visibility, f.display_order, f.type,
			CASE WHEN length(f.moderator_ids) <= ${MAX_MODERATOR_IDS_LENGTH} THEN f.moderator_ids ELSE NULL END
		FROM forums f JOIN authority a ON f.id = a.parent_id
		LIMIT ${FORUM_LIST_AUTHORITY_LIMIT}
	) SELECT * FROM authority ORDER BY id`)
		.bind(JSON.stringify([...new Set(ids)]))
		.all<ForumAuthorityRow>();
	if (!result.success) throw new Error("Forum authority could not be loaded");
	if (
		result.results.length > FORUM_LIST_AUTHORITY_MAX ||
		result.results.some((row) => row.moderator_ids === null)
	)
		throw new ForumListBoundError();
	return result.results;
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
	eligibleAnnouncements: AnnouncementRow[],
): Promise<PageSlice> {
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

async function loadAnnouncements(env: Env): Promise<AnnouncementRow[]> {
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
	return result.results;
}

async function loadRecommended(env: Env, forumId: number): Promise<RecommendedMember[]> {
	const page = await loadCatalogPage(env, {
		family: "recommended:threads",
		scope: "internal",
		params: { forumId },
	});
	return page.items.map(({ id, recommendedAt }) => ({ id, recommendedAt: recommendedAt ?? 0 }));
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

async function loadDisplay(
	env: Env,
	forums: readonly ForumAuthorityRow[],
	allowed: Set<number>,
	current: ForumAuthorityRow,
	config: ReadingConfig,
	members: readonly ThreadListMember[],
	recommended: readonly { row: RecommendedMember; gate: ThreadAccess }[],
	access: Map<number, ThreadAccess>,
): Promise<ForumListDisplay> {
	const relevant = relevantForums(forums, allowed, current.id);
	const topicIds = [
		...new Set([...members.map((row) => row.id), ...recommended.map(({ row }) => row.id)]),
	];
	const [entities, stats] = await Promise.all([
		loadThreadEntities(env, topicIds),
		loadThreadStats(env, topicIds),
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
				const display = config.forums.find((entry) => entry.id === row.id);
				return display
					? [
							{
								...display,
								parentId: row.parent_id,
								status: row.status,
								visibility: row.visibility,
								type: row.type as ForumType,
							},
						]
					: [];
			}),
		threads: members.flatMap(({ id }) => {
			const thread = byId.get(id);
			return thread ? [thread] : [];
		}),
		threadTypes: config.threadTypes,
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
