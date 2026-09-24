import type { HomeStats, HomeUser } from "./home";
import { isReadingBucket, type ReadingBucket } from "./reading";
import type { Forum, ForumThreadType, ForumThreadTypeConfig, Thread } from "./types";

export const FORUM_LIST_CONTEXT_PATH = "/api/v1/forums/context";
export const FORUM_LIST_MAX_BODY_BYTES = 4096;
export const FORUM_LIST_MAX_LIMIT = 100;
export const FORUM_LIST_MAX_ENTRY_BYTES = 128 * 1024;
export const FORUM_LIST_PAYLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
export const FORUM_LIST_TTL_MS = 30 * 60_000;

export interface ForumListContextRequest {
	forumId: number;
	page: number;
	limit: number;
	typeId: number | null;
	cachedBucket: ReadingBucket | null;
	cachedRevision: string | null;
	includeDisplay: boolean;
	includeStats: boolean;
	includeCount: boolean;
}

export interface ForumListRecommended {
	id: number;
	subject: string;
	authorId: number;
	authorName: string;
	replies: number;
	lastPostAt: number;
	recommendedAt: number;
}

export interface ForumListDisplay {
	forums: Forum[];
	threads: Thread[];
	threadTypes: ForumThreadTypeConfig & { types: ForumThreadType[] };
	recommended: ForumListRecommended[];
}

export interface ForumListSnapshot {
	revision: string;
	display: ForumListDisplay;
}

export interface ForumListContextData {
	bucket: ReadingBucket;
	user: HomeUser | null;
	revision: string;
	page: number;
	limit: number;
	typeId: number | null;
	hasNext: boolean;
	announcementCount: number;
	display?: ForumListDisplay;
	stats?: HomeStats;
	count?: number;
}

export type ForumListParseResult =
	| { ok: true; value: ForumListContextRequest }
	| { ok: false; message: string };

const REQUEST_KEYS = [
	"forumId",
	"page",
	"limit",
	"typeId",
	"cachedBucket",
	"cachedRevision",
	"includeDisplay",
	"includeStats",
	"includeCount",
] as const;

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseForumListContextRequest(body: unknown): ForumListParseResult {
	const fail = (message: string): ForumListParseResult => ({ ok: false, message });
	if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body");
	const record = body as Record<string, unknown>;
	if (Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))) {
		return fail("Unknown field");
	}
	if (REQUEST_KEYS.some((key) => !Object.hasOwn(record, key))) return fail("Invalid request body");
	if (!positive(record.forumId)) return fail("Invalid forumId");
	if (!positive(record.page)) return fail("Invalid page");
	if (!positive(record.limit) || record.limit > FORUM_LIST_MAX_LIMIT) return fail("Invalid limit");
	if (!Number.isSafeInteger((record.page - 1) * record.limit)) return fail("Invalid page");
	if (record.typeId !== null && !positive(record.typeId)) return fail("Invalid typeId");
	if (
		record.cachedBucket !== null &&
		(typeof record.cachedBucket !== "string" || !isReadingBucket(record.cachedBucket))
	)
		return fail("Invalid cachedBucket");
	if (
		record.cachedRevision !== null &&
		(typeof record.cachedRevision !== "string" || !/^[a-f0-9]{64}$/.test(record.cachedRevision))
	)
		return fail("Invalid cachedRevision");
	if (
		typeof record.includeDisplay !== "boolean" ||
		typeof record.includeStats !== "boolean" ||
		typeof record.includeCount !== "boolean"
	)
		return fail("Invalid include flag");
	return {
		ok: true,
		value: {
			forumId: record.forumId,
			page: record.page,
			limit: record.limit,
			typeId: record.typeId,
			cachedBucket: record.cachedBucket,
			cachedRevision: record.cachedRevision,
			includeDisplay: record.includeDisplay,
			includeStats: record.includeStats,
			includeCount: record.includeCount,
		},
	};
}

export function forumListCacheKey(
	bucket: ReadingBucket,
	forumId: number,
	page: number,
	limit: number,
	typeId: number | null,
): string {
	return `forum:${forumId}:bucket:${bucket}:page:${page}:limit:${limit}:type:${typeId ?? "all"}`;
}
