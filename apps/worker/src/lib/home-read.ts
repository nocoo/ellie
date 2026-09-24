import {
	type ForumSummaryGate,
	type ForumSummaryTopic,
	type ForumType,
	type ForumVisibility,
	HOME_DIGEST_LIMIT,
	type HomeDigestGate,
	type HomeDigestTopic,
	type HomeForum,
	type HomeUser,
	homeForumVisible,
	maskHomeDigestAuthor,
	type ReadingBucket,
} from "@ellie/types";
import { computeVisibilityBucket } from "./cache/bucket";
import type { ForumAggregateV2 } from "./cache/forum";
import { loadForumSnapshot, toForumSummaries } from "./cache/forum-read";
import type { Env } from "./env";
import { parseModeratorIds } from "./mappers";
import { buildVisibilityContext } from "./visibility";

const SQL_BATCH = 100;
const SUBJECT_MAX = 200;
const AUTHOR_NAME_MAX = 64;

interface ForumGateRow {
	id: number;
	parent_id: number;
	status: number;
	visibility: ForumVisibility;
}

interface ForumTextRow extends ForumGateRow {
	name: string;
	description: string;
	display_order: number;
	type: string;
	moderator_ids: string;
}

interface TopicRow {
	id: number;
	forum_id: number;
	sticky: number;
	anonymous_author: number;
	author_id: number;
	author_name: string;
	digest: number;
	subject: string;
	created_at: number;
	replies: number;
	views: number;
	forum_status: number;
	visibility: ForumVisibility;
}

interface UserRow {
	id: number;
	username: string;
	role: number;
	status: number;
	credits: number;
	coins: number;
	group_title: string;
	email: string;
	email_verified_at: number;
	email_changed_at: number;
}

export interface HomeAuthority {
	bucket: ReadingBucket;
	user: HomeUser | null;
	allowedForumIds: number[];
	allowed: Set<number>;
}

export function deriveHomeBucket(user: HomeUser | null): ReadingBucket {
	return computeVisibilityBucket(
		buildVisibilityContext(user ? { userId: user.id, role: user.role } : null),
	);
}

/** Direct D1 rows. Hidden ancestors exclude the whole descendant, not only its topic line. */
export function selectAllowedForumIds(
	rows: readonly ForumGateRow[],
	bucket: ReadingBucket,
): number[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const memo = new Map<number, boolean>();
	const visit = (id: number, stack: Set<number>): boolean => {
		const cached = memo.get(id);
		if (cached !== undefined) return cached;
		const row = byId.get(id);
		if (!row || stack.has(id)) {
			memo.set(id, false);
			return false;
		}
		if (row.status !== 1 || !homeForumVisible(row.visibility, bucket)) {
			memo.set(id, false);
			return false;
		}
		if (row.parent_id === 0 || row.parent_id === id) {
			memo.set(id, true);
			return true;
		}
		stack.add(id);
		const parentOk = visit(row.parent_id, stack);
		stack.delete(id);
		memo.set(id, parentOk);
		return parentOk;
	};
	return rows
		.map((row) => row.id)
		.filter((id) => visit(id, new Set()))
		.sort((a, b) => a - b);
}

export async function loadHomeUser(env: Env, userId: number): Promise<HomeUser | null> {
	const row = await env.DB.prepare(
		`SELECT id, username, role, status, credits, coins, group_title, email,
		        email_verified_at, email_changed_at
		 FROM users WHERE id = ?`,
	)
		.bind(userId)
		.first<UserRow>();
	if (!row) return null;
	if (row.status !== 0) return null;
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		status: row.status,
		credits: row.credits,
		coins: row.coins,
		groupTitle: row.group_title ?? "",
		email: row.email ?? "",
		emailVerifiedAt: row.email_verified_at ?? 0,
		emailChangedAt: row.email_changed_at ?? 0,
	};
}

export async function loadHomeAuthority(env: Env, user: HomeUser | null): Promise<HomeAuthority> {
	const bucket = deriveHomeBucket(user);
	const result = await env.DB.prepare(
		"SELECT id, parent_id, status, visibility FROM forums",
	).all<ForumGateRow>();
	if (!result.success) throw new Error("Home forums could not be loaded");
	const allowedForumIds = selectAllowedForumIds(result.results, bucket);
	return { bucket, user, allowedForumIds, allowed: new Set(allowedForumIds) };
}

export async function loadHomeDisplay(
	env: Env,
	authority: HomeAuthority,
	summaryTopicIds: readonly number[],
	digestTopicIds: readonly number[],
): Promise<{
	forums: HomeForum[];
	summaries: ForumSummaryTopic[];
	digest: HomeDigestTopic[];
	summaryGates: ForumSummaryGate[];
	digestGates: HomeDigestGate[];
}> {
	const forums = await loadForumText(env, authority.allowedForumIds);
	const [snapshot, digestIds, names] = await Promise.all([
		loadForumSnapshot(env),
		selectDigestIds(env, authority.allowedForumIds),
		loadModeratorNames(env, forums),
	]);
	const summaries = toForumSummaries(aggregatesFor(snapshot, authority.allowed));
	const topicIds = uniqueIds([
		...summaryTopicIds,
		...digestTopicIds,
		...summaries.map((row) => row.topicId),
		...digestIds,
	]);
	const topics = await loadTopicRows(env, topicIds, true);
	const summaryWanted = new Set([...summaryTopicIds, ...summaries.map((row) => row.topicId)]);
	const digestWanted = new Set([...digestTopicIds, ...digestIds]);
	const summaryGates = topics.flatMap((row) => {
		const gate = toSummaryGate(row, authority);
		return gate && summaryWanted.has(row.id) ? [gate] : [];
	});
	const digestGates = topics.flatMap((row) => {
		const gate = toDigestGate(row, authority);
		return gate && digestWanted.has(row.id) ? [gate] : [];
	});
	const summaryByTopic = new Map(summaryGates.map((gate) => [gate.topicId, gate]));
	const digestByTopic = new Map(digestGates.map((gate) => [gate.topicId, gate]));
	const topicById = new Map(topics.map((row) => [row.id, row]));
	return {
		forums: forums.map((row) => toHomeForum(row, names)),
		summaries: summaries.map((row) =>
			row.topicId === 0 || summaryByTopic.has(row.topicId) ? row : clearTopic(row),
		),
		digest: digestIds.flatMap((id) => {
			const row = topicById.get(id);
			const gate = digestByTopic.get(id);
			return row && gate ? [toDigestTopic(row)] : [];
		}),
		summaryGates: summaryGates.sort((a, b) => a.topicId - b.topicId),
		digestGates: digestGates.sort((a, b) => a.topicId - b.topicId),
	};
}

export async function loadHomeGates(
	env: Env,
	authority: HomeAuthority,
	summaryTopicIds: readonly number[],
	digestTopicIds: readonly number[],
): Promise<{ summaryGates: ForumSummaryGate[]; digestGates: HomeDigestGate[] }> {
	const topics = await loadTopicRows(env, uniqueIds([...summaryTopicIds, ...digestTopicIds]));
	const summaryWanted = new Set(summaryTopicIds);
	const digestWanted = new Set(digestTopicIds);
	return {
		summaryGates: topics
			.flatMap((row) => {
				const gate = toSummaryGate(row, authority);
				return gate && summaryWanted.has(row.id) ? [gate] : [];
			})
			.sort((a, b) => a.topicId - b.topicId),
		digestGates: topics
			.flatMap((row) => {
				const gate = toDigestGate(row, authority);
				return gate && digestWanted.has(row.id) ? [gate] : [];
			})
			.sort((a, b) => a.topicId - b.topicId),
	};
}

function aggregatesFor(
	snapshot: Awaited<ReturnType<typeof loadForumSnapshot>>,
	allowed: Set<number>,
): Record<number, ForumAggregateV2> {
	const aggregates: Record<number, ForumAggregateV2> = {};
	for (const row of snapshot) {
		if (!allowed.has(row.id)) continue;
		aggregates[row.id] = {
			threads: row.threads,
			posts: row.posts,
			todayThreads: row.todayThreads,
			lastThreadId: row.lastThreadId,
			lastThreadSubject: row.lastThreadSubject,
			lastPostAt: row.lastPostAt,
			lastPoster: row.lastPoster,
			lastPosterId: row.lastPosterId,
			lastPosterAvatar: row.lastPosterAvatar,
			lastPosterAvatarPath: row.lastPosterAvatarPath,
			anonAware: 1,
		};
	}
	return aggregates;
}

function toHomeForum(row: ForumTextRow, names: Map<number, string>): HomeForum {
	return {
		id: row.id,
		parentId: row.parent_id,
		name: row.name,
		description: row.description ?? "",
		displayOrder: row.display_order,
		type: row.type as ForumType,
		status: row.status,
		visibility: row.visibility,
		moderatorList: parseModeratorIds(row.moderator_ids).flatMap((id) => {
			const name = names.get(id);
			return name ? [{ id, name }] : [];
		}),
	};
}

function clearTopic(summary: ForumSummaryTopic): ForumSummaryTopic {
	return {
		...summary,
		topicId: 0,
		topicSubject: "",
		topicCreatedAt: 0,
		authorId: 0,
		authorName: "",
		authorAvatar: "",
		authorAvatarPath: "",
	};
}

function toSummaryGate(row: TopicRow, authority: HomeAuthority): ForumSummaryGate | null {
	if (!authority.allowed.has(row.forum_id)) return null;
	if (row.forum_status !== 1 || row.sticky < 0 || row.anonymous_author !== 0) return null;
	if (!homeForumVisible(row.visibility, authority.bucket)) return null;
	if (row.author_id <= 0) return null;
	return {
		topicId: row.id,
		forumId: row.forum_id,
		forumStatus: row.forum_status,
		visibility: row.visibility,
		sticky: row.sticky,
		anonymousAuthor: 0,
		authorId: row.author_id,
	};
}

function toDigestGate(row: TopicRow, authority: HomeAuthority): HomeDigestGate | null {
	if (!authority.allowed.has(row.forum_id)) return null;
	if (row.forum_status !== 1 || row.sticky < 0) return null;
	if (row.digest < 1 || row.digest > 3) return null;
	if (!homeForumVisible(row.visibility, authority.bucket)) return null;
	const author = maskHomeDigestAuthor(row.anonymous_author, row.author_id, row.author_name);
	if (author.anonymousAuthor === 0 && author.authorId <= 0) return null;
	return {
		topicId: row.id,
		forumId: row.forum_id,
		sticky: row.sticky,
		digest: row.digest,
		anonymousAuthor: author.anonymousAuthor,
		authorId: author.authorId,
	};
}

function toDigestTopic(row: TopicRow): HomeDigestTopic {
	const author = maskHomeDigestAuthor(row.anonymous_author, row.author_id, row.author_name);
	return {
		id: row.id,
		forumId: row.forum_id,
		subject: cut(row.subject, SUBJECT_MAX),
		digest: row.digest,
		createdAt: nonnegative(row.created_at),
		replies: nonnegative(row.replies),
		views: nonnegative(row.views),
		anonymousAuthor: author.anonymousAuthor,
		authorId: author.authorId,
		authorName:
			author.anonymousAuthor === 1 ? author.authorName : cut(author.authorName, AUTHOR_NAME_MAX),
	};
}

async function loadForumText(env: Env, allowedIds: readonly number[]): Promise<ForumTextRow[]> {
	const result = await env.DB.prepare(
		`SELECT id, parent_id, name, description, display_order, type, status, visibility, moderator_ids
		 FROM forums
		 WHERE id IN (SELECT value FROM json_each(?))
		 ORDER BY display_order, id`,
	)
		.bind(JSON.stringify(allowedIds))
		.all<ForumTextRow>();
	if (!result.success) throw new Error("Home forum text could not be loaded");
	return result.results;
}

async function selectDigestIds(env: Env, allowedIds: readonly number[]): Promise<number[]> {
	const result = await env.DB.prepare(
		`SELECT t.id
		 FROM threads t INDEXED BY idx_threads_digest
		 WHERE t.digest > 0 AND t.sticky >= 0
		   AND t.forum_id IN (SELECT value FROM json_each(?))
		 ORDER BY t.digest DESC, t.last_post_at DESC, t.id DESC
		 LIMIT ?`,
	)
		.bind(JSON.stringify(allowedIds), HOME_DIGEST_LIMIT)
		.all<{ id: number }>();
	if (!result.success) throw new Error("Home digest could not be loaded");
	return result.results.map((row) => row.id);
}

async function loadTopicRows(env: Env, ids: number[], includeDisplay = false): Promise<TopicRow[]> {
	const displayColumns = includeDisplay
		? "COALESCE(u.username, t.author_name) AS author_name, t.subject, t.created_at, t.replies, t.views"
		: "'' AS author_name, '' AS subject, 0 AS created_at, 0 AS replies, 0 AS views";
	const authorJoin = includeDisplay ? "LEFT JOIN users u ON u.id = t.author_id" : "";
	const rows: TopicRow[] = [];
	for (let start = 0; start < ids.length; start += SQL_BATCH) {
		const part = ids.slice(start, start + SQL_BATCH);
		const result = await env.DB.prepare(
			`SELECT t.id, t.forum_id, t.sticky, t.anonymous_author, t.author_id,
			        t.digest, ${displayColumns},
			        f.status AS forum_status, f.visibility
			 FROM threads t JOIN forums f ON f.id = t.forum_id ${authorJoin}
			 WHERE t.id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<TopicRow>();
		if (!result.success) throw new Error("Home topic gates could not be loaded");
		rows.push(...result.results);
	}
	return rows;
}

async function loadModeratorNames(
	env: Env,
	forums: readonly ForumTextRow[],
): Promise<Map<number, string>> {
	const ids = uniqueIds(forums.flatMap((row) => parseModeratorIds(row.moderator_ids)));
	const names = new Map<number, string>();
	for (let start = 0; start < ids.length; start += SQL_BATCH) {
		const part = ids.slice(start, start + SQL_BATCH);
		const result = await env.DB.prepare(
			`SELECT id, username FROM users WHERE id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<{ id: number; username: string }>();
		if (!result.success) throw new Error("Home moderators could not be loaded");
		for (const row of result.results) names.set(row.id, row.username);
	}
	return names;
}

function uniqueIds(ids: readonly number[]): number[] {
	return [...new Set(ids.filter((id) => id > 0))];
}

function cut(value: string, max: number): string {
	const text = value ?? "";
	return text.length <= max ? text : text.slice(0, max);
}

function nonnegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
