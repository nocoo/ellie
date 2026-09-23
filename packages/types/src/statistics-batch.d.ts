/** Worker statistics batch contract. Management shape lives in memory-cache.ts. */
export declare const STATISTICS_BATCH_PATH = "/api/internal/statistics/batch";
export declare const STATISTICS_WRITE_HEADER = "X-Ellie-Statistics-Key";
export declare const STATISTICS_BATCH_NO_STORE = "no-store";
export declare const STATISTICS_BATCH_MAX_BODY_BYTES = 65536;
export declare const STATISTICS_BATCH_MAX_VIEWS = 256;
export declare const STATISTICS_BATCH_MAX_ACTIVITIES = 256;
export declare const STATISTICS_VIEW_INCREMENT_MAX = 1000;
export declare const STATISTICS_ID_MAX: number;
export declare const STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS = 120;
export declare const STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS = 86400;
export declare const STATISTICS_BATCH_ERROR_CODES: readonly ["BAD_REQUEST", "UNAUTHORIZED", "METHOD_NOT_ALLOWED", "NOT_CONFIGURED"];
export type StatisticsBatchErrorCode = (typeof STATISTICS_BATCH_ERROR_CODES)[number];
export declare const STATISTICS_BATCH_HTTP_STATUS: Record<StatisticsBatchErrorCode, number>;
export declare const STATISTICS_WRITE_STATUSES: readonly ["confirmed", "rejected", "unconfirmed"];
export type StatisticsWriteStatus = (typeof STATISTICS_WRITE_STATUSES)[number];
export declare const STATISTICS_BATCH_MESSAGES: {
    readonly unauthorized: "Unauthorized";
    readonly notConfigured: "Statistics write key is not configured";
    readonly methodNotAllowed: "POST required";
    readonly invalidBody: "Invalid request body";
    readonly unknownField: "Unknown field";
    readonly invalidJson: "Malformed JSON body";
    readonly bodyTooLarge: "Request body is too large";
    readonly invalidContentType: "Content-Type must be application/json";
    readonly emptyBatch: "Batch is empty";
    readonly invalidViews: "Invalid views";
    readonly invalidActivities: "Invalid activities";
    readonly duplicateThread: "Duplicate threadId";
    readonly duplicateUser: "Duplicate userId";
    readonly invalidThreadId: "Invalid threadId";
    readonly invalidIncrement: "Invalid increment";
    readonly invalidUserId: "Invalid userId";
    readonly invalidObservedAt: "Invalid observedAt";
    readonly observedAtOutOfRange: "observedAt is out of range";
    readonly invalidResult: "Invalid statistics batch result";
};
export interface StatisticsViewIncrement {
    threadId: number;
    increment: number;
}
export interface StatisticsActivityObservation {
    userId: number;
    observedAt: number;
}
/** Both arrays are required. One may be empty. Duplicates fail the whole request. */
export interface StatisticsBatchRequest {
    views: StatisticsViewIncrement[];
    activities: StatisticsActivityObservation[];
}
export interface StatisticsViewResult extends StatisticsViewIncrement {
    status: StatisticsWriteStatus;
}
export interface StatisticsActivityResult extends StatisticsActivityObservation {
    status: StatisticsWriteStatus;
}
/**
 * Explicit per-item accounting in request order.
 * HTTP 200 means this accounting was produced, not that every item committed.
 * A missing or non-200 response leaves the whole request unconfirmed.
 */
export interface StatisticsBatchResult {
    views: StatisticsViewResult[];
    activities: StatisticsActivityResult[];
}
export interface StatisticsBatchError {
    code: StatisticsBatchErrorCode;
    message: string;
}
export interface StatisticsBatchDataEnvelope {
    data: StatisticsBatchResult;
}
export interface StatisticsBatchErrorEnvelope {
    error: StatisticsBatchError;
}
export type StatisticsBatchParseResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: StatisticsBatchError;
};
export declare function statisticsBatchError(code: StatisticsBatchErrorCode, message: string): StatisticsBatchError;
export declare function statisticsBatchErrorEnvelope(code: StatisticsBatchErrorCode, message: string): StatisticsBatchErrorEnvelope;
export declare function isStatisticsWriteStatus(value: string): value is StatisticsWriteStatus;
/** Structural validation only. Clock bounds are `observedAtInRange`. */
export declare function parseStatisticsBatchRequest(body: unknown): StatisticsBatchParseResult<StatisticsBatchRequest>;
/** Inclusive unix-second window against the worker clock. */
export declare function observedAtInRange(observedAt: number, nowSeconds: number): boolean;
export declare function parseStatisticsBatchResult(body: unknown): StatisticsBatchParseResult<StatisticsBatchResult>;
