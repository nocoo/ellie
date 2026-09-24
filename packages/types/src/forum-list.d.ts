import type { HomeStats, HomeUser } from "./home";
import { type ReadingBucket } from "./reading";
import type { Forum, ForumThreadType, ForumThreadTypeConfig, Thread } from "./types";
export declare const FORUM_LIST_CONTEXT_PATH = "/api/v1/forums/context";
export declare const FORUM_LIST_MAX_BODY_BYTES = 4096;
export declare const FORUM_LIST_MAX_LIMIT = 100;
export declare const FORUM_LIST_MAX_ENTRY_BYTES: number;
export declare const FORUM_LIST_PAYLOAD_LIMIT_BYTES: number;
export declare const FORUM_LIST_TTL_MS: number;
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
    threadTypes: ForumThreadTypeConfig & {
        types: ForumThreadType[];
    };
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
    display?: ForumListDisplay;
    stats?: HomeStats;
    count?: number;
}
export type ForumListParseResult = {
    ok: true;
    value: ForumListContextRequest;
} | {
    ok: false;
    message: string;
};
export declare function parseForumListContextRequest(body: unknown): ForumListParseResult;
export declare function forumListCacheKey(bucket: ReadingBucket, forumId: number, page: number, limit: number, typeId: number | null): string;
