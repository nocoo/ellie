/** Offset-page and forum-summary HTTP contract for migrated statistics. */
export declare const THREAD_COUNT_PATH = "/api/v1/threads/count";
export declare const FORUM_SUMMARIES_PATH = "/api/v1/forums/summaries";
export declare const FORUM_SUMMARY_GATES_PATH = "/api/v1/forums/summary-gates";
export declare const READING_BUCKETS: readonly ["anon", "member", "staff", "admin"];
export type ReadingBucket = (typeof READING_BUCKETS)[number];
export declare const READING_TOPIC_GATE_MAX = 256;
export declare const READING_SUBJECT_MAX = 200;
export declare const READING_AUTHOR_NAME_MAX = 64;
export declare const READING_MESSAGES: {
    readonly invalidQuery: "Invalid query";
    readonly unknownQuery: "Unknown query parameter";
    readonly repeatedQuery: "Repeated query parameter";
    readonly invalidForumId: "Invalid forumId";
    readonly invalidTypeId: "Invalid typeId";
    readonly invalidIncludeTotal: "Invalid includeTotal";
    readonly invalidTopics: "Invalid topics";
    readonly duplicateTopic: "Duplicate topicId";
};
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
export type ReadingParseResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    message: string;
};
export declare function isReadingBucket(value: string): value is ReadingBucket;
export declare function parseThreadCountQuery(searchParams: URLSearchParams): ReadingParseResult<ThreadCountQuery>;
/** `false` only when the parameter is exactly false. Any other explicit value fails. */
export declare function parseIncludeTotal(raw: string | null): ReadingParseResult<boolean>;
export declare function parseSummaryGateQuery(searchParams: URLSearchParams): ReadingParseResult<SummaryGateQuery>;
