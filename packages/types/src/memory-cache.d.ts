/** Process-local Next.js memory cache management contract. */
export declare const MEMORY_CACHE_WEB_PATH = "/api/internal/memory-cache";
export declare const MEMORY_CACHE_ADMIN_PATH = "/api/admin/memory-cache";
export declare const MEMORY_CACHE_ADMIN_HEADER = "X-Ellie-Memory-Key";
export declare const MEMORY_CACHE_NO_STORE = "no-store";
export declare const MEMORY_CACHE_FAMILIES: readonly ["site-stats", "forum-summary", "thread-count"];
export type MemoryCacheFamilyId = (typeof MEMORY_CACHE_FAMILIES)[number];
export declare const MEMORY_CACHE_ACTIONS: readonly ["clear", "flush"];
export type MemoryCacheAction = (typeof MEMORY_CACHE_ACTIONS)[number];
export declare const MEMORY_CACHE_FAMILY_CAPACITY: Record<MemoryCacheFamilyId, number>;
export declare const MEMORY_CACHE_PAYLOAD_LIMIT_BYTES: number;
export declare const MEMORY_CACHE_PREVIEW_MAX_BYTES = 512;
export declare const MEMORY_CACHE_HISTORY_LIMIT = 60;
export declare const MEMORY_CACHE_TTL_MS: number;
export declare const MEMORY_CACHE_PAGE_DEFAULT = 1;
export declare const MEMORY_CACHE_LIMIT_DEFAULT = 50;
export declare const MEMORY_CACHE_LIMIT_MIN = 1;
export declare const MEMORY_CACHE_LIMIT_MAX = 100;
export declare const MEMORY_CACHE_PAGE_MAX = 10000;
export declare const MEMORY_CACHE_INSTANCE_ID_MAX = 128;
export declare const MEMORY_CACHE_KEY_MAX = 256;
export declare const MEMORY_CACHE_VERSION_MAX = 64;
export declare const MEMORY_CACHE_ERROR_MESSAGE_MAX = 200;
export declare const MEMORY_CACHE_ERROR_CODES: readonly ["UNAUTHORIZED", "BAD_REQUEST", "INSTANCE_CONFLICT", "NOT_CONFIGURED", "UPSTREAM_UNAVAILABLE"];
export type MemoryCacheErrorCode = (typeof MEMORY_CACHE_ERROR_CODES)[number];
export declare const MEMORY_CACHE_HTTP_STATUS: Record<MemoryCacheErrorCode, number>;
export declare const MEMORY_CACHE_MESSAGES: {
    readonly unauthorized: "Unauthorized";
    readonly notConfigured: "Memory cache management is not configured";
    readonly instanceConflict: "Memory cache instance changed";
    readonly upstreamUnavailable: "Memory cache management is unavailable";
    readonly unknownQuery: "Unknown query parameter";
    readonly repeatedQuery: "Repeated query parameter";
    readonly invalidFamily: "Unknown memory cache family";
    readonly invalidPage: "Invalid page";
    readonly invalidLimit: "Invalid limit";
    readonly invalidBody: "Invalid request body";
    readonly unknownField: "Unknown field";
    readonly unknownAction: "Unknown action";
    readonly invalidInstanceId: "Invalid instanceId";
    readonly flushRejectsSelector: "Flush does not accept family or key";
    readonly keyRequiresFamily: "Clear key requires family";
    readonly invalidKey: "Invalid key";
};
/** ISO-8601 UTC from Date.toISOString(). Nullable timestamps use null. */
export declare const MEMORY_CACHE_TIMESTAMP: RegExp;
export interface MemoryCacheInstance {
    id: string;
    version: string;
    startedAt: string;
    uptimeMs: number;
}
export interface MemoryCacheMemory {
    rssBytes: number;
    heapUsedBytes: number;
    estimatedPayloadBytes: number;
    payloadLimitBytes: number;
}
export interface MemoryCacheFamilyStats {
    id: MemoryCacheFamilyId;
    entries: number;
    maxEntries: number;
    hits: number;
    misses: number;
    evictions: number;
    loadErrors: number;
}
export interface MemoryCacheEntry {
    family: MemoryCacheFamilyId;
    key: string;
    createdAt: string;
    expiresAt: string;
    estimatedBytes: number;
    preview: string;
}
export interface MemoryCachePagination {
    page: number;
    limit: number;
    total: number;
}
export interface MemoryCacheBuffers {
    pendingThreads: number;
    pendingViews: number;
    pendingUsers: number;
    oldestPendingAt: string | null;
    flushing: boolean;
    lastFlushAt: string | null;
    lastSuccessAt: string | null;
    unconfirmedViews: number;
    droppedViews: number;
    droppedActivities: number;
}
export interface MemoryCacheHistorySample {
    at: string;
    estimatedPayloadBytes: number;
    pendingViews: number;
}
/** Counters are since process start. `family` filters entries only. */
export interface MemoryCacheOverview {
    instance: MemoryCacheInstance;
    memory: MemoryCacheMemory;
    families: MemoryCacheFamilyStats[];
    entries: MemoryCacheEntry[];
    pagination: MemoryCachePagination;
    buffers: MemoryCacheBuffers;
    history: MemoryCacheHistorySample[];
}
export interface MemoryCacheQuery {
    family?: MemoryCacheFamilyId;
    page: number;
    limit: number;
}
export type MemoryCacheMutation = {
    instanceId: string;
    action: "flush";
} | {
    instanceId: string;
    action: "clear";
} | {
    instanceId: string;
    action: "clear";
    family: MemoryCacheFamilyId;
} | {
    instanceId: string;
    action: "clear";
    family: MemoryCacheFamilyId;
    key: string;
};
export interface MemoryCacheError {
    code: MemoryCacheErrorCode;
    message: string;
}
export interface MemoryCacheDataEnvelope<T> {
    data: T;
}
export interface MemoryCacheErrorEnvelope {
    error: MemoryCacheError;
}
export type MemoryCacheOverviewResponse = MemoryCacheDataEnvelope<MemoryCacheOverview>;
export type MemoryCacheMutationResponse = MemoryCacheDataEnvelope<{
    ok: true;
}>;
export type MemoryCacheParseResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: MemoryCacheError;
};
export declare function isMemoryCacheFamilyId(value: string): value is MemoryCacheFamilyId;
export declare function isMemoryCacheAction(value: string): value is MemoryCacheAction;
export declare function memoryCacheError(code: MemoryCacheErrorCode, message: string): MemoryCacheError;
export declare function memoryCacheErrorEnvelope(code: MemoryCacheErrorCode, message: string): MemoryCacheErrorEnvelope;
export declare function parseMemoryCacheQuery(searchParams: URLSearchParams): MemoryCacheParseResult<MemoryCacheQuery>;
export declare function parseMemoryCacheMutation(body: unknown): MemoryCacheParseResult<MemoryCacheMutation>;
/** Truncate to the preview byte ceiling without splitting a UTF-8 code point. */
export declare function boundMemoryCachePreview(value: string): string;
