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

import type { PublicUser, User } from "@ellie/types";
import { UserStatus } from "@ellie/types";

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
// Error type (thin subclass keeps instanceof / .name distinct from AdminApiError)
// ---------------------------------------------------------------------------

import { ApiError, type ApiErrorData } from "./api-error";

export type ForumApiErrorData = ApiErrorData;

export class ForumApiError extends ApiError {
	constructor(status: number, data: ApiErrorData);
	constructor(status: number, code: string, message: string);
	constructor(status: number, dataOrCode: ApiErrorData | string, message?: string) {
		if (typeof dataOrCode === "string") {
			super(status, dataOrCode, message ?? "");
		} else {
			super(status, dataOrCode);
		}
		this.name = "ForumApiError";
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

export interface PageMeta extends ApiMeta {
	total: number;
	page: number;
	limit: number;
	pages: number;
}

export interface PagePaginatedResponse<T> {
	data: T[];
	meta: PageMeta;
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

/** Client context forwarded by BFF proxy routes so the Worker sees the real user. */
export interface ClientContext {
	/** Client IP forwarded as X-Real-IP */
	ip?: string;
	/** Client User-Agent forwarded as X-Real-User-Agent */
	userAgent?: string;
}

interface RequestOptions {
	method: string;
	path: string;
	body?: unknown;
	searchParams?: Record<string, string | number | boolean | undefined | null>;
	bearerToken?: string;
	/** Client IP to forward to Worker for rate limiting (X-Real-IP header) */
	clientIP?: string;
	/** Client User-Agent to forward as X-Real-User-Agent */
	clientUA?: string;
	/** Next.js ISR revalidation interval in seconds. When set, replaces cache: "no-store". */
	revalidate?: number;
}

function buildHeaders(opts: RequestOptions): Record<string, string> {
	const headers: Record<string, string> = {
		"X-API-Key": getApiKey(),
	};
	if (opts.bearerToken) {
		headers.Authorization = `Bearer ${opts.bearerToken}`;
	}
	if (opts.clientIP) {
		headers["X-Ellie-Client-IP"] = opts.clientIP;
	}
	if (opts.clientUA) {
		headers["X-Real-User-Agent"] = opts.clientUA;
	}
	if (opts.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	return headers;
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

	const headers = buildHeaders(opts);

	const res = await fetch(url.toString(), {
		method: opts.method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		...(opts.revalidate != null
			? { next: { revalidate: opts.revalidate } }
			: { cache: "no-store" as const }),
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
		// `errorData` is the wrapped `{ code, message, details? }` shape used by
		// most Worker errors. The flat docs/17 §5.4 EmailNotVerifiedPayload uses
		// a *string* discriminator at `json.error` instead — when that happens
		// `errorData` is the literal "EMAIL_NOT_VERIFIED" string, which fails
		// the wrapped contract. Fall back to a synthetic wrapped record so the
		// throw-site invariant holds, but stash the raw body on the error so
		// proxy callers can re-emit the original payload verbatim.
		const isWrapped =
			errorData != null && typeof errorData === "object" && typeof errorData.code === "string";
		const wrapped: ForumApiErrorData = isWrapped
			? errorData
			: typeof json.error === "string"
				? {
						code: json.error,
						message:
							typeof json.message === "string" ? json.message : `Worker returned ${res.status}`,
					}
				: { code: "UNKNOWN", message: `Worker returned ${res.status}` };
		const err = new ForumApiError(res.status, wrapped);
		err.rawBody = json;
		throw err;
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

export interface GetOptions {
	/** Next.js ISR revalidation interval in seconds. Omit for no-store. */
	revalidate?: number;
}

export const forumApi = {
	/** GET single resource: { data: T, meta } */
	async get<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
		options?: GetOptions,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({
			method: "GET",
			path,
			searchParams,
			revalidate: options?.revalidate,
		});
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

	/** GET list with keyset cursor pagination + Bearer token */
	async getCursorAuth<T>(
		path: string,
		bearerToken: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<CursorPaginatedResponse<T>> {
		const result = await request<T[]>({ method: "GET", path, searchParams, bearerToken });
		return {
			data: result.data,
			meta: {
				...(result.meta as ApiMeta),
				nextCursor: (result.meta as CursorMeta).nextCursor ?? null,
			},
		};
	},

	/** GET list with offset pagination: { data: T[], meta: { total, page, limit, pages } } */
	async getPage<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<PagePaginatedResponse<T>> {
		const result = await request<T[]>({ method: "GET", path, searchParams });
		return {
			data: result.data,
			meta: result.meta as PageMeta,
		};
	},

	/** GET with Bearer token (authenticated Worker API call) */
	async getAuth<T>(
		path: string,
		bearerToken: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
		client?: ClientContext,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({
			method: "GET",
			path,
			searchParams,
			bearerToken,
			clientIP: client?.ip,
			clientUA: client?.userAgent,
		});
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** POST: { data: T, meta } */
	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "POST", path, body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** POST with client IP forwarding (for rate-limited endpoints like login/register) */
	async postWithIP<T>(
		path: string,
		body: unknown,
		clientIP: string,
		clientUA?: string,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "POST", path, body, clientIP, clientUA });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** GET with client IP forwarding (for rate-limited endpoints like check-username) */
	async getWithIP<T>(
		path: string,
		searchParams: Record<string, string | number | boolean | undefined | null>,
		clientIP: string,
		clientUA?: string,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "GET", path, searchParams, clientIP, clientUA });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** POST with Bearer token (authenticated Worker API call) */
	async postAuth<T>(
		path: string,
		body: unknown,
		bearerToken: string,
		client?: ClientContext,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({
			method: "POST",
			path,
			body,
			bearerToken,
			clientIP: client?.ip,
			clientUA: client?.userAgent,
		});
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** PATCH with Bearer token (authenticated Worker API call) */
	async patchAuth<T>(
		path: string,
		body: unknown,
		bearerToken: string,
		client?: ClientContext,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({
			method: "PATCH",
			path,
			body,
			bearerToken,
			clientIP: client?.ip,
			clientUA: client?.userAgent,
		});
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/** DELETE with Bearer token (authenticated Worker API call) */
	async deleteAuth<T>(
		path: string,
		body: unknown,
		bearerToken: string,
		client?: ClientContext,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({
			method: "DELETE",
			path,
			body,
			bearerToken,
			clientIP: client?.ip,
			clientUA: client?.userAgent,
		});
		return { data: result.data, meta: result.meta as ApiMeta };
	},
};

// ---------------------------------------------------------------------------
// Type mappers
// ---------------------------------------------------------------------------

/**
 * Map Worker's PublicUser to frontend User.
 * PublicUser fields are spread; User-only fields filled with safe defaults.
 */
export function publicUserToUser(pu: PublicUser): User {
	return {
		...pu,
		email: "",
		status: UserStatus.Active,
		lastLogin: 0,
		// Verification state is never exposed via PublicUser; default to
		// "unverified" sentinel here (docs/17-email-verification.md §3).
		emailVerifiedAt: 0,
		emailNormalized: "",
		emailChangedAt: 0,
		purgedAt: 0,
		purgedBy: 0,
	};
}
