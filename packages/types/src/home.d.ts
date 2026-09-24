/** Homepage context transport. Worker owns authority; Web caches display only. */
import { type VisibilityContext } from "./forum";
import type { ForumSummaryGate, ForumSummaryTopic } from "./reading";
import { type ReadingBucket } from "./reading";
import type { ForumType, ForumVisibility, ModeratorInfo } from "./types";
export declare const HOME_CONTEXT_PATH = "/api/v1/home/context";
export declare const HOME_CONTEXT_MAX_BODY_BYTES = 32768;
export declare const HOME_SUMMARY_TOPIC_MAX = 512;
export declare const HOME_DIGEST_TOPIC_MAX = 5;
export declare const HOME_DIGEST_LIMIT = 5;
export declare const HOME_ANONYMOUS_AUTHOR_NAME = "\u533F\u540D";
export declare const HOME_MESSAGES: {
    readonly invalidBody: "Invalid request body";
    readonly invalidJson: "Invalid JSON";
    readonly invalidContentType: "Invalid content type";
    readonly bodyTooLarge: "Request body too large";
    readonly unknownField: "Unknown field";
    readonly unknownQuery: "Unknown query parameter";
    readonly invalidBucket: "Invalid cachedBucket";
    readonly invalidFlag: "Invalid include flag";
    readonly invalidTopics: "Invalid topic ids";
    readonly duplicateTopic: "Duplicate topicId";
    readonly tooManyTopics: "Too many topic ids";
};
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
export type HomeParseResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    message: string;
};
export declare function homeVisibilityContext(bucket: ReadingBucket): VisibilityContext;
export declare function homeForumVisible(visibility: ForumVisibility, bucket: ReadingBucket): boolean;
/** Caller-independent. Anonymous digest authors are always masked, including staff and the owner. */
export declare function maskHomeDigestAuthor(anonymousAuthor: number, authorId: number, authorName: string): {
    anonymousAuthor: 0 | 1;
    authorId: number;
    authorName: string;
};
export declare function homeDigestGatePasses(gate: HomeDigestGate, row: Pick<HomeDigestTopic, "id" | "forumId" | "authorId" | "digest" | "anonymousAuthor">, allowedForumIds: ReadonlySet<number>): boolean;
export declare function parseHomeContextRequest(body: unknown): HomeParseResult<HomeContextRequest>;
