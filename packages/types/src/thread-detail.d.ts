/** Thread detail context transport. Worker owns authority; Web caches display only. */
import type { HomeStats, HomeUser } from "./home";
import type { Attachment, ForumVisibility, ModeratorInfo, Post, PublicUser, Thread } from "./types";
export declare const THREAD_DETAIL_CONTEXT_PATH = "/api/v1/threads/context";
export declare const THREAD_DETAIL_MAX_BODY_BYTES = 4096;
export declare const THREAD_DETAIL_MAX_LIMIT = 100;
export declare const THREAD_DETAIL_MESSAGES: {
    readonly invalidBody: "Invalid request body";
    readonly invalidJson: "Invalid JSON";
    readonly invalidContentType: "Invalid content type";
    readonly bodyTooLarge: "Request body too large";
    readonly unknownField: "Unknown field";
    readonly unknownQuery: "Unknown query parameter";
    readonly invalidThreadId: "Invalid threadId";
    readonly invalidLimit: "Invalid limit";
    readonly invalidCursor: "Invalid cursor";
    readonly invalidLast: "Invalid last";
    readonly invalidRevision: "Invalid cachedRevision";
    readonly invalidFlag: "Invalid include flag";
};
/** Matches `ForumContext` in apps/web/src/lib/forum-data.ts. `forum` is null when an ancestor is hidden. */
export interface ThreadForumContext {
    id: number;
    parentId: number;
    name: string;
    status: number;
    visibility: ForumVisibility;
    type: string;
    moderators: string;
    moderatorIds: string;
    moderatorList: ModeratorInfo[];
}
/** Matches `AncestorItem` in apps/web/src/lib/forum-data.ts. */
export interface ThreadAncestor {
    id: number;
    parentId: number;
    name: string;
}
export interface ThreadDetailContextRequest {
    threadId: number;
    limit: number;
    cursor: string | null;
    last: boolean;
    cachedRevision: string | null;
    includeDisplay: boolean;
    includeStats: boolean;
}
export interface ThreadDetailDisplay {
    posts: Post[];
    authors: PublicUser[];
    attachments: Attachment[];
    forum: ThreadForumContext | null;
    ancestors: ThreadAncestor[];
}
export interface ThreadDetailContextData {
    thread: Thread;
    user: HomeUser | null;
    revision: string;
    cacheable: boolean;
    nextCursor: string | null;
    stats?: HomeStats;
    display?: ThreadDetailDisplay;
}
export interface ThreadDetailSnapshot {
    selection: string;
    revision: string;
    display: ThreadDetailDisplay;
}
export type ThreadDetailParseResult = {
    ok: true;
    value: ThreadDetailContextRequest;
} | {
    ok: false;
    message: string;
};
/** Canonical snapshot selection. Last-page mode ignores cursor position. */
export declare function threadDetailSelection(threadId: number, limit: number, cursorPosition: number | null, last: boolean): string;
/** Strict `{ position }` cursor. Rejects extra keys, non-integers, and negatives. */
export declare function decodeThreadDetailCursor(cursor: string): number | null;
export declare function parseThreadDetailContextRequest(body: unknown): ThreadDetailParseResult;
