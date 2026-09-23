/** Offset-page and forum-summary HTTP contract for migrated statistics. */

export const THREAD_COUNT_PATH = "/api/v1/threads/count";
export const FORUM_SUMMARIES_PATH = "/api/v1/forums/summaries";
export const FORUM_SUMMARY_GATES_PATH = "/api/v1/forums/summary-gates";

export const READING_BUCKETS = ["anon", "member", "staff", "admin"] as const;
export type ReadingBucket = (typeof READING_BUCKETS)[number];

export const READING_TOPIC_GATE_MAX = 256;
export const READING_SUBJECT_MAX = 200;
export const READING_AUTHOR_NAME_MAX = 64;

export const READING_MESSAGES = {
	invalidQuery: "Invalid query",
	unknownQuery: "Unknown query parameter",
	repeatedQuery: "Repeated query parameter",
	invalidForumId: "Invalid forumId",
	invalidTypeId: "Invalid typeId",
	invalidIncludeTotal: "Invalid includeTotal",
	invalidTopics: "Invalid topics",
	duplicateTopic: "Duplicate topicId",
} as const;

const COUNT_KEYS = new Set(["forumId", "typeId"]);
const GATE_KEYS = new Set(["topics"]);
const POSITIVE_INT = /^[1-9][0-9]*$/;

export interface ThreadCountData {
	total: number;
}

/** Present only when includeTotal=false and the read is an offset page. */
export interface ThreadOffsetPageMeta {
	page: number;
	limit: number;
	hasNext: boolean;
}

/**
 * Latest visible non-anonymous topic in one forum, by created_at then id.
 * Existing forum list fields lastThread* / lastPoster* / lastPostAt carry these
 * values: author and creation time, not the latest reply.
 */
export interface ForumSummaryTopic {
	forumId: number;
	threads: number;
	posts: number;
	todayThreads: number;
	topicId: number;
	topicSubject: string;
	topicCreatedAt: number;
	authorId: number;
	authorName: string;
	authorAvatar: string;
	authorAvatarPath: string;
}

/** Authorization row. Omitted ids are hidden or absent; the two are not distinguished. */
export interface ForumSummaryGate {
	topicId: number;
	forumId: number;
	forumStatus: number;
	visibility: "public" | "members" | "staff" | "admin";
	sticky: number;
	anonymousAuthor: number;
	authorId: number;
}

export interface ThreadCountQuery {
	forumId: number;
	typeId?: number;
}

export interface SummaryGateQuery {
	topicIds: number[];
}

export type ReadingParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function isReadingBucket(value: string): value is ReadingBucket {
	return (READING_BUCKETS as readonly string[]).includes(value);
}

export function parseThreadCountQuery(
	searchParams: URLSearchParams,
): ReadingParseResult<ThreadCountQuery> {
	const keys = uniqueKeys(searchParams);
	if (!keys.ok) return keys;
	if (![...keys.value].every((key) => COUNT_KEYS.has(key))) {
		return fail(READING_MESSAGES.unknownQuery);
	}
	const forumId = requiredId(searchParams.get("forumId"), READING_MESSAGES.invalidForumId);
	if (typeof forumId !== "number") return forumId;
	const typeId = optionalId(searchParams.get("typeId"), READING_MESSAGES.invalidTypeId);
	if (typeof typeId !== "number" && typeId !== undefined) return typeId;
	return { ok: true, value: typeId === undefined ? { forumId } : { forumId, typeId } };
}

/** `false` only when the parameter is exactly false. Any other explicit value fails. */
export function parseIncludeTotal(raw: string | null): ReadingParseResult<boolean> {
	if (raw === null || raw === "true") return { ok: true, value: true };
	if (raw === "false") return { ok: true, value: false };
	return fail(READING_MESSAGES.invalidIncludeTotal);
}

export function parseSummaryGateQuery(
	searchParams: URLSearchParams,
): ReadingParseResult<SummaryGateQuery> {
	const keys = uniqueKeys(searchParams);
	if (!keys.ok) return keys;
	if (![...keys.value].every((key) => GATE_KEYS.has(key))) {
		return fail(READING_MESSAGES.unknownQuery);
	}
	const raw = searchParams.get("topics");
	if (!raw) return fail(READING_MESSAGES.invalidTopics);
	const parts = raw.split(",");
	if (parts.length === 0 || parts.length > READING_TOPIC_GATE_MAX) {
		return fail(READING_MESSAGES.invalidTopics);
	}
	const topicIds: number[] = [];
	const seen = new Set<number>();
	for (const part of parts) {
		if (!POSITIVE_INT.test(part)) return fail(READING_MESSAGES.invalidTopics);
		const id = Number(part);
		if (!Number.isSafeInteger(id)) return fail(READING_MESSAGES.invalidTopics);
		if (seen.has(id)) return fail(READING_MESSAGES.duplicateTopic);
		seen.add(id);
		topicIds.push(id);
	}
	return { ok: true, value: { topicIds } };
}

function fail(message: string): { ok: false; message: string } {
	return { ok: false, message };
}

function uniqueKeys(searchParams: URLSearchParams): ReadingParseResult<Set<string>> {
	const keys = new Set(searchParams.keys());
	for (const key of keys) {
		if (searchParams.getAll(key).length !== 1) return fail(READING_MESSAGES.repeatedQuery);
	}
	return { ok: true, value: keys };
}

function requiredId(raw: string | null, message: string): number | { ok: false; message: string } {
	if (raw === null || !POSITIVE_INT.test(raw)) return fail(message);
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) return fail(message);
	return value;
}

function optionalId(
	raw: string | null,
	message: string,
): number | undefined | { ok: false; message: string } {
	if (raw === null) return undefined;
	return requiredId(raw, message);
}
