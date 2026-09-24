/** Homepage context transport. Worker owns authority; Web caches display only. */

import { canViewForum, type VisibilityContext } from "./forum";
import type { ForumSummaryGate, ForumSummaryTopic } from "./reading";
import { isReadingBucket, type ReadingBucket } from "./reading";
import type { ForumType, ForumVisibility, ModeratorInfo } from "./types";
import { UserRole } from "./types";

export const HOME_CONTEXT_PATH = "/api/v1/home/context";
export const HOME_CONTEXT_MAX_BODY_BYTES = 32_768;
export const HOME_SUMMARY_TOPIC_MAX = 512;
export const HOME_DIGEST_TOPIC_MAX = 5;
export const HOME_DIGEST_LIMIT = 5;
export const HOME_ANONYMOUS_AUTHOR_NAME = "匿名";

export const HOME_MESSAGES = {
	invalidBody: "Invalid request body",
	invalidJson: "Invalid JSON",
	invalidContentType: "Invalid content type",
	bodyTooLarge: "Request body too large",
	unknownField: "Unknown field",
	unknownQuery: "Unknown query parameter",
	invalidBucket: "Invalid cachedBucket",
	invalidFlag: "Invalid include flag",
	invalidTopics: "Invalid topic ids",
	duplicateTopic: "Duplicate topicId",
	tooManyTopics: "Too many topic ids",
} as const;

const REQUEST_KEYS = [
	"cachedBucket",
	"includeDisplay",
	"includeStats",
	"summaryTopicIds",
	"digestTopicIds",
] as const;

export interface HomeContextRequest {
	cachedBucket: ReadingBucket | null;
	includeDisplay: boolean;
	includeStats: boolean;
	summaryTopicIds: number[];
	digestTopicIds: number[];
}

export interface HomeUser {
	id: number;
	username: string;
	role: number;
	status: number;
	credits: number;
	coins: number;
	groupTitle: string;
	email: string;
	emailVerifiedAt: number;
	emailChangedAt: number;
}

/** Structural fields homepage cards render. Counters and topic lines live in summaries. */
export interface HomeForum {
	id: number;
	parentId: number;
	name: string;
	description: string;
	displayOrder: number;
	type: ForumType;
	status: number;
	visibility: ForumVisibility;
	moderatorList: ModeratorInfo[];
}

export interface HomeDigestTopic {
	id: number;
	forumId: number;
	subject: string;
	digest: number;
	createdAt: number;
	replies: number;
	views: number;
	anonymousAuthor: 0 | 1;
	authorId: number;
	authorName: string;
}

export interface HomeDigestGate {
	topicId: number;
	forumId: number;
	sticky: number;
	digest: number;
	anonymousAuthor: 0 | 1;
	authorId: number;
}

export interface HomeStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalPosts: number;
	totalMembers: number;
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

export interface HomeDisplay {
	forums: HomeForum[];
	summaries: ForumSummaryTopic[];
	digest: HomeDigestTopic[];
}

export interface HomeContextData {
	bucket: ReadingBucket;
	user: HomeUser | null;
	allowedForumIds: number[];
	summaryGates: ForumSummaryGate[];
	digestGates: HomeDigestGate[];
	display?: HomeDisplay;
	stats?: HomeStats;
}

export type HomeParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function homeVisibilityContext(bucket: ReadingBucket): VisibilityContext {
	switch (bucket) {
		case "anon":
			return { isLoggedIn: false, role: UserRole.User };
		case "member":
			return { isLoggedIn: true, role: UserRole.User };
		case "staff":
			return { isLoggedIn: true, role: UserRole.Mod };
		case "admin":
			return { isLoggedIn: true, role: UserRole.Admin };
	}
}

export function homeForumVisible(visibility: ForumVisibility, bucket: ReadingBucket): boolean {
	return canViewForum(visibility, homeVisibilityContext(bucket));
}

/** Caller-independent. Anonymous digest authors are always masked, including staff and the owner. */
export function maskHomeDigestAuthor(
	anonymousAuthor: number,
	authorId: number,
	authorName: string,
): { anonymousAuthor: 0 | 1; authorId: number; authorName: string } {
	if (anonymousAuthor === 1) {
		return { anonymousAuthor: 1, authorId: 0, authorName: HOME_ANONYMOUS_AUTHOR_NAME };
	}
	return {
		anonymousAuthor: 0,
		authorId,
		authorName,
	};
}

export function homeDigestGatePasses(
	gate: HomeDigestGate,
	row: Pick<HomeDigestTopic, "id" | "forumId" | "authorId" | "digest" | "anonymousAuthor">,
	allowedForumIds: ReadonlySet<number>,
): boolean {
	return (
		allowedForumIds.has(gate.forumId) &&
		allowedForumIds.has(row.forumId) &&
		gate.topicId === row.id &&
		gate.forumId === row.forumId &&
		gate.sticky >= 0 &&
		gate.digest === row.digest &&
		gate.digest >= 1 &&
		gate.digest <= 3 &&
		gate.anonymousAuthor === row.anonymousAuthor &&
		gate.authorId === row.authorId &&
		(gate.anonymousAuthor === 1 ? gate.authorId === 0 : gate.authorId > 0)
	);
}

export function parseHomeContextRequest(body: unknown): HomeParseResult<HomeContextRequest> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return fail(HOME_MESSAGES.invalidBody);
	}
	const record = body as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))) {
		return fail(HOME_MESSAGES.unknownField);
	}
	if (REQUEST_KEYS.some((key) => !(key in record))) {
		return fail(HOME_MESSAGES.invalidBody);
	}
	const cachedBucket = record.cachedBucket;
	if (
		cachedBucket !== null &&
		(typeof cachedBucket !== "string" || !isReadingBucket(cachedBucket))
	) {
		return fail(HOME_MESSAGES.invalidBucket);
	}
	if (typeof record.includeDisplay !== "boolean" || typeof record.includeStats !== "boolean") {
		return fail(HOME_MESSAGES.invalidFlag);
	}
	const summaryTopicIds = parseIds(record.summaryTopicIds, HOME_SUMMARY_TOPIC_MAX);
	if (!summaryTopicIds.ok) return summaryTopicIds;
	const digestTopicIds = parseIds(record.digestTopicIds, HOME_DIGEST_TOPIC_MAX);
	if (!digestTopicIds.ok) return digestTopicIds;
	return {
		ok: true,
		value: {
			cachedBucket,
			includeDisplay: record.includeDisplay,
			includeStats: record.includeStats,
			summaryTopicIds: summaryTopicIds.value,
			digestTopicIds: digestTopicIds.value,
		},
	};
}

function parseIds(value: unknown, max: number): HomeParseResult<number[]> {
	if (!Array.isArray(value)) return fail(HOME_MESSAGES.invalidTopics);
	if (value.length > max) return fail(HOME_MESSAGES.tooManyTopics);
	const ids: number[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0) {
			return fail(HOME_MESSAGES.invalidTopics);
		}
		if (seen.has(item)) return fail(HOME_MESSAGES.duplicateTopic);
		seen.add(item);
		ids.push(item);
	}
	return { ok: true, value: ids };
}

function fail(message: string): { ok: false; message: string } {
	return { ok: false, message };
}
