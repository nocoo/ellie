/**
 * Server-side Forum API client for communicating with the Worker.
 *
 * - Only used in Server Components (forum pages)
 * - Injects X-API-Key header (Key A) automatically
 * - Parses the { data, meta } / { error } response envelope
 * - Throws ForumApiError on non-2xx responses
 *
 * Mirrors admin-api.ts pattern but uses FORUM_API_KEY (Key A) for public v1 endpoints.
 */

import "server-only";

import { UserStatus } from "@ellie/types";
import type { PublicUser, User } from "@ellie/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getWorkerUrl(): string {
	const url = process.env.WORKER_API_URL;
	if (!url) throw new Error("WORKER_API_URL environment variable is not set");
	return url.replace(/\/+$/, "");
}

function getApiKey(): string {
	const key = process.env.FORUM_API_KEY;
	if (!key) throw new Error("FORUM_API_KEY environment variable is not set");
	return key;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface ForumApiErrorData {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export class ForumApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(status: number, data: ForumApiErrorData) {
		super(data.message);
		this.name = "ForumApiError";
		this.status = status;
		this.code = data.code;
		this.details = data.details;
	}
}

// ---------------------------------------------------------------------------
// Response types (v1 endpoints use keyset cursor, not offset)
// ---------------------------------------------------------------------------

export interface ApiMeta {
	timestamp: number;
	requestId: string;
}

export interface CursorMeta extends ApiMeta {
	nextCursor: string | null;
}

export interface ApiResponse<T> {
	data: T;
	meta: ApiMeta;
}

export interface CursorPaginatedResponse<T> {
	data: T[];
	meta: CursorMeta;
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

interface RequestOptions {
	method: string;
	path: string;
	body?: unknown;
	searchParams?: Record<string, string | number | boolean | undefined | null>;
}

async function request<T>(
	opts: RequestOptions,
): Promise<{ data: T; meta: ApiMeta & Partial<CursorMeta>; status: number }> {
	const url = new URL(opts.path, getWorkerUrl());

	if (opts.searchParams) {
		for (const [key, value] of Object.entries(opts.searchParams)) {
			if (value !== undefined && value !== null && value !== "") {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const headers: Record<string, string> = {
		"X-API-Key": getApiKey(),
	};

	if (opts.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url.toString(), {
		method: opts.method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		cache: "no-store",
	});

	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		throw new ForumApiError(res.status, {
			code: "PARSE_ERROR",
			message: `Failed to parse Worker response: ${text.slice(0, 200)}`,
		});
	}

	if (!res.ok) {
		const errorData = json.error as ForumApiErrorData | undefined;
		throw new ForumApiError(
			res.status,
			errorData ?? { code: "UNKNOWN", message: `Worker returned ${res.status}` },
		);
	}

	return {
		data: json.data as T,
		meta: (json.meta ?? {}) as ApiMeta & Partial<CursorMeta>,
		status: res.status,
	};
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

export const forumApi = {
	/** GET single resource: { data: T, meta } */
	async get<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "GET", path, searchParams });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** GET list (no pagination): { data: T[], meta } */
	async getAll<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<{ data: T[]; meta: ApiMeta }> {
		const result = await request<T[]>({ method: "GET", path, searchParams });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** GET list with keyset cursor pagination: { data: T[], meta: { nextCursor } } */
	async getCursor<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<CursorPaginatedResponse<T>> {
		const result = await request<T[]>({ method: "GET", path, searchParams });
		return {
			data: result.data,
			meta: {
				...(result.meta as ApiMeta),
				nextCursor: (result.meta as CursorMeta).nextCursor ?? null,
			},
		};
	},

	/** POST: { data: T, meta } */
	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "POST", path, body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},
};

// ---------------------------------------------------------------------------
// Type mappers
// ---------------------------------------------------------------------------

/**
 * Map Worker's PublicUser (7 fields) to frontend User (11 fields).
 * Private fields are filled with safe defaults.
 */
export function publicUserToUser(pu: PublicUser): User {
	return {
		...pu,
		email: "",
		status: UserStatus.Active,
		lastLogin: 0,
		credits: 0,
	};
}
