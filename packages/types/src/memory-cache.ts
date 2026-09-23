/** Process-local Next.js memory cache management contract. */

export const MEMORY_CACHE_WEB_PATH = "/api/internal/memory-cache";
export const MEMORY_CACHE_ADMIN_PATH = "/api/admin/memory-cache";
export const MEMORY_CACHE_ADMIN_HEADER = "X-Ellie-Memory-Key";
export const MEMORY_CACHE_NO_STORE = "no-store";

export const MEMORY_CACHE_FAMILIES = ["site-stats", "forum-summary", "thread-count"] as const;
export type MemoryCacheFamilyId = (typeof MEMORY_CACHE_FAMILIES)[number];

export const MEMORY_CACHE_ACTIONS = ["clear", "flush"] as const;
export type MemoryCacheAction = (typeof MEMORY_CACHE_ACTIONS)[number];

export const MEMORY_CACHE_FAMILY_CAPACITY: Record<MemoryCacheFamilyId, number> = {
	"site-stats": 1,
	"forum-summary": 256,
	"thread-count": 1024,
};

export const MEMORY_CACHE_PAYLOAD_LIMIT_BYTES = 8 * 1024 * 1024;
export const MEMORY_CACHE_PREVIEW_MAX_BYTES = 512;
export const MEMORY_CACHE_HISTORY_LIMIT = 60;
export const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;

export const MEMORY_CACHE_PAGE_DEFAULT = 1;
export const MEMORY_CACHE_LIMIT_DEFAULT = 50;
export const MEMORY_CACHE_LIMIT_MIN = 1;
export const MEMORY_CACHE_LIMIT_MAX = 100;
export const MEMORY_CACHE_PAGE_MAX = 10_000;
export const MEMORY_CACHE_INSTANCE_ID_MAX = 128;
export const MEMORY_CACHE_KEY_MAX = 256;
export const MEMORY_CACHE_VERSION_MAX = 64;
export const MEMORY_CACHE_ERROR_MESSAGE_MAX = 200;

export const MEMORY_CACHE_ERROR_CODES = [
	"UNAUTHORIZED",
	"BAD_REQUEST",
	"INSTANCE_CONFLICT",
	"NOT_CONFIGURED",
	"UPSTREAM_UNAVAILABLE",
] as const;
export type MemoryCacheErrorCode = (typeof MEMORY_CACHE_ERROR_CODES)[number];

export const MEMORY_CACHE_HTTP_STATUS: Record<MemoryCacheErrorCode, number> = {
	UNAUTHORIZED: 401,
	BAD_REQUEST: 400,
	INSTANCE_CONFLICT: 409,
	NOT_CONFIGURED: 503,
	UPSTREAM_UNAVAILABLE: 502,
};

export const MEMORY_CACHE_MESSAGES = {
	unauthorized: "Unauthorized",
	notConfigured: "Memory cache management is not configured",
	instanceConflict: "Memory cache instance changed",
	upstreamUnavailable: "Memory cache management is unavailable",
	unknownQuery: "Unknown query parameter",
	repeatedQuery: "Repeated query parameter",
	invalidFamily: "Unknown memory cache family",
	invalidPage: "Invalid page",
	invalidLimit: "Invalid limit",
	invalidBody: "Invalid request body",
	unknownField: "Unknown field",
	unknownAction: "Unknown action",
	invalidInstanceId: "Invalid instanceId",
	flushRejectsSelector: "Flush does not accept family or key",
	keyRequiresFamily: "Clear key requires family",
	invalidKey: "Invalid key",
} as const;

/** ISO-8601 UTC from Date.toISOString(). Nullable timestamps use null. */
export const MEMORY_CACHE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const QUERY_KEYS = new Set(["family", "page", "limit"]);
const MUTATION_KEYS = new Set(["instanceId", "action", "family", "key"]);
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POSITIVE_INT = /^[1-9][0-9]*$/;

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

export type MemoryCacheMutation =
	| { instanceId: string; action: "flush" }
	| { instanceId: string; action: "clear" }
	| { instanceId: string; action: "clear"; family: MemoryCacheFamilyId }
	| { instanceId: string; action: "clear"; family: MemoryCacheFamilyId; key: string };

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
export type MemoryCacheMutationResponse = MemoryCacheDataEnvelope<{ ok: true }>;

export type MemoryCacheParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: MemoryCacheError };

export function isMemoryCacheFamilyId(value: string): value is MemoryCacheFamilyId {
	return (MEMORY_CACHE_FAMILIES as readonly string[]).includes(value);
}

export function isMemoryCacheAction(value: string): value is MemoryCacheAction {
	return (MEMORY_CACHE_ACTIONS as readonly string[]).includes(value);
}

export function memoryCacheError(code: MemoryCacheErrorCode, message: string): MemoryCacheError {
	return { code, message };
}

export function memoryCacheErrorEnvelope(
	code: MemoryCacheErrorCode,
	message: string,
): MemoryCacheErrorEnvelope {
	return { error: memoryCacheError(code, message) };
}

export function parseMemoryCacheQuery(
	searchParams: URLSearchParams,
): MemoryCacheParseResult<MemoryCacheQuery> {
	for (const key of new Set(searchParams.keys())) {
		if (!QUERY_KEYS.has(key)) {
			return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.unknownQuery);
		}
		if (searchParams.getAll(key).length !== 1) {
			return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.repeatedQuery);
		}
	}

	const familyRaw = searchParams.get("family");
	let family: MemoryCacheFamilyId | undefined;
	if (familyRaw !== null) {
		if (!isMemoryCacheFamilyId(familyRaw)) {
			return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidFamily);
		}
		family = familyRaw;
	}

	const page = parseBoundedInt(
		searchParams.get("page"),
		MEMORY_CACHE_PAGE_DEFAULT,
		1,
		MEMORY_CACHE_PAGE_MAX,
		MEMORY_CACHE_MESSAGES.invalidPage,
	);
	if (typeof page !== "number") return page;

	const limit = parseBoundedInt(
		searchParams.get("limit"),
		MEMORY_CACHE_LIMIT_DEFAULT,
		MEMORY_CACHE_LIMIT_MIN,
		MEMORY_CACHE_LIMIT_MAX,
		MEMORY_CACHE_MESSAGES.invalidLimit,
	);
	if (typeof limit !== "number") return limit;

	return { ok: true, value: family ? { family, page, limit } : { page, limit } };
}

export function parseMemoryCacheMutation(
	body: unknown,
): MemoryCacheParseResult<MemoryCacheMutation> {
	if (!isPlainObject(body)) return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidBody);
	for (const key of Object.keys(body)) {
		if (!MUTATION_KEYS.has(key)) return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.unknownField);
	}

	const instanceId = body.instanceId;
	if (typeof instanceId !== "string" || !INSTANCE_ID.test(instanceId)) {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidInstanceId);
	}
	const action = body.action;
	if (typeof action !== "string" || !isMemoryCacheAction(action)) {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.unknownAction);
	}

	const familyResult = optionalFamily(body.family);
	if (!familyResult.ok) return familyResult;
	const keyResult = optionalKey(body.key);
	if (!keyResult.ok) return keyResult;

	if (action === "flush") {
		if (familyResult.value !== undefined || keyResult.value !== undefined) {
			return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.flushRejectsSelector);
		}
		return { ok: true, value: { instanceId, action: "flush" } };
	}
	if (keyResult.value !== undefined && familyResult.value === undefined) {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.keyRequiresFamily);
	}
	if (familyResult.value === undefined) {
		return { ok: true, value: { instanceId, action: "clear" } };
	}
	if (keyResult.value === undefined) {
		return { ok: true, value: { instanceId, action: "clear", family: familyResult.value } };
	}
	return {
		ok: true,
		value: {
			instanceId,
			action: "clear",
			family: familyResult.value,
			key: keyResult.value,
		},
	};
}

/** Truncate to the preview byte ceiling without splitting a UTF-8 code point. */
export function boundMemoryCachePreview(value: string): string {
	const encoded = new TextEncoder().encode(value);
	if (encoded.byteLength <= MEMORY_CACHE_PREVIEW_MAX_BYTES) return value;
	let end = MEMORY_CACHE_PREVIEW_MAX_BYTES;
	while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
	return new TextDecoder().decode(encoded.subarray(0, end));
}

function fail(code: MemoryCacheErrorCode, message: string): { ok: false; error: MemoryCacheError } {
	return { ok: false, error: memoryCacheError(code, message) };
}

function parseBoundedInt(
	raw: string | null,
	fallback: number,
	min: number,
	max: number,
	message: string,
): number | { ok: false; error: MemoryCacheError } {
	if (raw === null) return fallback;
	if (!POSITIVE_INT.test(raw)) return fail("BAD_REQUEST", message);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		return fail("BAD_REQUEST", message);
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function optionalFamily(value: unknown): MemoryCacheParseResult<MemoryCacheFamilyId | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	if (typeof value !== "string" || !isMemoryCacheFamilyId(value)) {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidFamily);
	}
	return { ok: true, value };
}

function optionalKey(value: unknown): MemoryCacheParseResult<string | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	if (typeof value !== "string" || value.length === 0 || value.length > MEMORY_CACHE_KEY_MAX) {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidKey);
	}
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidKey);
	}
	return { ok: true, value };
}
