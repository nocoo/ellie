/** Worker statistics batch contract. Management shape lives in memory-cache.ts. */

export const STATISTICS_BATCH_PATH = "/api/internal/statistics/batch";
export const STATISTICS_WRITE_HEADER = "X-Ellie-Statistics-Key";
export const STATISTICS_BATCH_NO_STORE = "no-store";

export const STATISTICS_BATCH_MAX_BODY_BYTES = 65_536;
export const STATISTICS_BATCH_MAX_VIEWS = 256;
export const STATISTICS_BATCH_MAX_ACTIVITIES = 256;
export const STATISTICS_VIEW_INCREMENT_MAX = 1_000;
export const STATISTICS_ID_MAX = Number.MAX_SAFE_INTEGER;
export const STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS = 120;
export const STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS = 86_400;

export const STATISTICS_BATCH_ERROR_CODES = [
	"BAD_REQUEST",
	"UNAUTHORIZED",
	"METHOD_NOT_ALLOWED",
	"NOT_CONFIGURED",
] as const;
export type StatisticsBatchErrorCode = (typeof STATISTICS_BATCH_ERROR_CODES)[number];

export const STATISTICS_BATCH_HTTP_STATUS: Record<StatisticsBatchErrorCode, number> = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	METHOD_NOT_ALLOWED: 405,
	NOT_CONFIGURED: 503,
};

export const STATISTICS_WRITE_STATUSES = ["confirmed", "rejected", "unconfirmed"] as const;
export type StatisticsWriteStatus = (typeof STATISTICS_WRITE_STATUSES)[number];

export const STATISTICS_BATCH_MESSAGES = {
	unauthorized: "Unauthorized",
	notConfigured: "Statistics write key is not configured",
	methodNotAllowed: "POST required",
	invalidBody: "Invalid request body",
	unknownField: "Unknown field",
	invalidJson: "Malformed JSON body",
	bodyTooLarge: "Request body is too large",
	invalidContentType: "Content-Type must be application/json",
	emptyBatch: "Batch is empty",
	invalidViews: "Invalid views",
	invalidActivities: "Invalid activities",
	duplicateThread: "Duplicate threadId",
	duplicateUser: "Duplicate userId",
	invalidThreadId: "Invalid threadId",
	invalidIncrement: "Invalid increment",
	invalidUserId: "Invalid userId",
	invalidObservedAt: "Invalid observedAt",
	observedAtOutOfRange: "observedAt is out of range",
	invalidResult: "Invalid statistics batch result",
} as const;

const REQUEST_KEYS = new Set(["views", "activities"]);
const VIEW_KEYS = new Set(["threadId", "increment"]);
const ACTIVITY_KEYS = new Set(["userId", "observedAt"]);
const RESULT_KEYS = new Set(["views", "activities"]);
const VIEW_RESULT_KEYS = new Set(["threadId", "increment", "status"]);
const ACTIVITY_RESULT_KEYS = new Set(["userId", "observedAt", "status"]);

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

export type StatisticsBatchParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: StatisticsBatchError };

export function statisticsBatchError(
	code: StatisticsBatchErrorCode,
	message: string,
): StatisticsBatchError {
	return { code, message };
}

export function statisticsBatchErrorEnvelope(
	code: StatisticsBatchErrorCode,
	message: string,
): StatisticsBatchErrorEnvelope {
	return { error: statisticsBatchError(code, message) };
}

export function isStatisticsWriteStatus(value: string): value is StatisticsWriteStatus {
	return (STATISTICS_WRITE_STATUSES as readonly string[]).includes(value);
}

/** Structural validation only. Clock bounds are `observedAtInRange`. */
export function parseStatisticsBatchRequest(
	body: unknown,
): StatisticsBatchParseResult<StatisticsBatchRequest> {
	if (!isPlainObject(body)) return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidBody);
	if (!sameKeys(body, REQUEST_KEYS))
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.unknownField);
	if (!Array.isArray(body.views))
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidViews);
	if (!Array.isArray(body.activities)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidActivities);
	}
	if (body.views.length === 0 && body.activities.length === 0) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.emptyBatch);
	}
	if (body.views.length > STATISTICS_BATCH_MAX_VIEWS) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidViews);
	}
	if (body.activities.length > STATISTICS_BATCH_MAX_ACTIVITIES) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidActivities);
	}

	const views: StatisticsViewIncrement[] = [];
	const seenThreads = new Set<number>();
	for (const item of body.views) {
		const parsed = parseView(item);
		if (!parsed.ok) return parsed;
		if (seenThreads.has(parsed.value.threadId)) {
			return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.duplicateThread);
		}
		seenThreads.add(parsed.value.threadId);
		views.push(parsed.value);
	}

	const activities: StatisticsActivityObservation[] = [];
	const seenUsers = new Set<number>();
	for (const item of body.activities) {
		const parsed = parseActivity(item);
		if (!parsed.ok) return parsed;
		if (seenUsers.has(parsed.value.userId)) {
			return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.duplicateUser);
		}
		seenUsers.add(parsed.value.userId);
		activities.push(parsed.value);
	}
	return { ok: true, value: { views, activities } };
}

/** Inclusive unix-second window against the worker clock. */
export function observedAtInRange(observedAt: number, nowSeconds: number): boolean {
	return (
		observedAt >= nowSeconds - STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS &&
		observedAt <= nowSeconds + STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS
	);
}

export function parseStatisticsBatchResult(
	body: unknown,
): StatisticsBatchParseResult<StatisticsBatchResult> {
	if (!isPlainObject(body) || !Object.hasOwn(body, "data") || !isPlainObject(body.data)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (!sameKeys(body.data, RESULT_KEYS)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (!Array.isArray(body.data.views) || !Array.isArray(body.data.activities)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	const views: StatisticsViewResult[] = [];
	for (const item of body.data.views) {
		const parsed = parseViewResult(item);
		if (!parsed.ok) return parsed;
		views.push(parsed.value);
	}
	const activities: StatisticsActivityResult[] = [];
	for (const item of body.data.activities) {
		const parsed = parseActivityResult(item);
		if (!parsed.ok) return parsed;
		activities.push(parsed.value);
	}
	return { ok: true, value: { views, activities } };
}

function fail(
	code: StatisticsBatchErrorCode,
	message: string,
): { ok: false; error: StatisticsBatchError } {
	return { ok: false, error: statisticsBatchError(code, message) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function sameKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
	const keys = Object.keys(value);
	return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function positiveId(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 1 &&
		value <= STATISTICS_ID_MAX
	);
}

function parseView(item: unknown): StatisticsBatchParseResult<StatisticsViewIncrement> {
	if (!isPlainObject(item) || !sameKeys(item, VIEW_KEYS)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidViews);
	}
	if (!positiveId(item.threadId))
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidThreadId);
	if (
		typeof item.increment !== "number" ||
		!Number.isSafeInteger(item.increment) ||
		item.increment < 1 ||
		item.increment > STATISTICS_VIEW_INCREMENT_MAX
	) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidIncrement);
	}
	return { ok: true, value: { threadId: item.threadId, increment: item.increment } };
}

function parseActivity(item: unknown): StatisticsBatchParseResult<StatisticsActivityObservation> {
	if (!isPlainObject(item) || !sameKeys(item, ACTIVITY_KEYS)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidActivities);
	}
	if (!positiveId(item.userId)) return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidUserId);
	if (typeof item.observedAt !== "number" || !Number.isSafeInteger(item.observedAt)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidObservedAt);
	}
	return { ok: true, value: { userId: item.userId, observedAt: item.observedAt } };
}

function parseViewResult(item: unknown): StatisticsBatchParseResult<StatisticsViewResult> {
	if (!isPlainObject(item) || !sameKeys(item, VIEW_RESULT_KEYS) || !positiveId(item.threadId)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (
		typeof item.increment !== "number" ||
		!Number.isSafeInteger(item.increment) ||
		item.increment < 1 ||
		item.increment > STATISTICS_VIEW_INCREMENT_MAX
	) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (typeof item.status !== "string" || !isStatisticsWriteStatus(item.status)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	return {
		ok: true,
		value: { threadId: item.threadId, increment: item.increment, status: item.status },
	};
}

function parseActivityResult(item: unknown): StatisticsBatchParseResult<StatisticsActivityResult> {
	if (!isPlainObject(item) || !sameKeys(item, ACTIVITY_RESULT_KEYS) || !positiveId(item.userId)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (typeof item.observedAt !== "number" || !Number.isSafeInteger(item.observedAt)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	if (typeof item.status !== "string" || !isStatisticsWriteStatus(item.status)) {
		return fail("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidResult);
	}
	return {
		ok: true,
		value: { userId: item.userId, observedAt: item.observedAt, status: item.status },
	};
}
