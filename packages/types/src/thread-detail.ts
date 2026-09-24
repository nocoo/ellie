/** Thread detail context transport. Worker owns authority; Web caches display only. */

import type { HomeStats, HomeUser } from "./home";
import type { Attachment, ForumVisibility, ModeratorInfo, Post, PublicUser, Thread } from "./types";

export const THREAD_DETAIL_CONTEXT_PATH = "/api/v1/threads/context";
export const THREAD_DETAIL_MAX_BODY_BYTES = 4096;
export const THREAD_DETAIL_MAX_LIMIT = 100;

export const THREAD_DETAIL_MESSAGES = {
	invalidBody: "Invalid request body",
	invalidJson: "Invalid JSON",
	invalidContentType: "Invalid content type",
	bodyTooLarge: "Request body too large",
	unknownField: "Unknown field",
	unknownQuery: "Unknown query parameter",
	invalidThreadId: "Invalid threadId",
	invalidLimit: "Invalid limit",
	invalidCursor: "Invalid cursor",
	invalidLast: "Invalid last",
	invalidRevision: "Invalid cachedRevision",
	invalidFlag: "Invalid include flag",
} as const;

const REQUEST_KEYS = [
	"threadId",
	"limit",
	"cursor",
	"last",
	"cachedRevision",
	"includeDisplay",
	"includeStats",
] as const;

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

export type ThreadDetailParseResult =
	| { ok: true; value: ThreadDetailContextRequest }
	| { ok: false; message: string };

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Canonical snapshot selection. Last-page mode ignores cursor position. */
export function threadDetailSelection(
	threadId: number,
	limit: number,
	cursorPosition: number | null,
	last: boolean,
): string {
	const cursor = last || cursorPosition === null ? "start" : String(cursorPosition);
	return `thread:${threadId}:limit:${limit}:cursor:${cursor}:mode:${last ? "last" : "forward"}`;
}

/** Strict `{ position }` cursor. Rejects extra keys, non-integers, and negatives. */
export function decodeThreadDetailCursor(cursor: string): number | null {
	try {
		const parsed: unknown = JSON.parse(atob(cursor));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "position")) return null;
		const position = record.position;
		if (!Number.isSafeInteger(position) || Number(position) < 0) return null;
		return position as number;
	} catch {
		return null;
	}
}

export function parseThreadDetailContextRequest(body: unknown): ThreadDetailParseResult {
	const fail = (message: string): ThreadDetailParseResult => ({ ok: false, message });
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return fail(THREAD_DETAIL_MESSAGES.invalidBody);
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).some((key) => !(REQUEST_KEYS as readonly string[]).includes(key))) {
		return fail(THREAD_DETAIL_MESSAGES.unknownField);
	}
	if (REQUEST_KEYS.some((key) => !Object.hasOwn(record, key))) {
		return fail(THREAD_DETAIL_MESSAGES.invalidBody);
	}
	if (!positive(record.threadId)) return fail(THREAD_DETAIL_MESSAGES.invalidThreadId);
	if (!positive(record.limit) || record.limit > THREAD_DETAIL_MAX_LIMIT) {
		return fail(THREAD_DETAIL_MESSAGES.invalidLimit);
	}
	if (typeof record.last !== "boolean") return fail(THREAD_DETAIL_MESSAGES.invalidLast);
	if (record.cursor !== null && typeof record.cursor !== "string") {
		return fail(THREAD_DETAIL_MESSAGES.invalidCursor);
	}
	if (record.last && record.cursor !== null) return fail(THREAD_DETAIL_MESSAGES.invalidCursor);
	if (typeof record.cursor === "string" && decodeThreadDetailCursor(record.cursor) === null) {
		return fail(THREAD_DETAIL_MESSAGES.invalidCursor);
	}
	if (
		record.cachedRevision !== null &&
		(typeof record.cachedRevision !== "string" || !/^[a-f0-9]{64}$/.test(record.cachedRevision))
	) {
		return fail(THREAD_DETAIL_MESSAGES.invalidRevision);
	}
	if (typeof record.includeDisplay !== "boolean" || typeof record.includeStats !== "boolean") {
		return fail(THREAD_DETAIL_MESSAGES.invalidFlag);
	}
	return {
		ok: true,
		value: {
			threadId: record.threadId,
			limit: record.limit,
			cursor: record.cursor,
			last: record.last,
			cachedRevision: record.cachedRevision,
			includeDisplay: record.includeDisplay,
			includeStats: record.includeStats,
		},
	};
}
