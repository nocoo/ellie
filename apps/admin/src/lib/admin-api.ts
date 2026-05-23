/**
 * Server-side Admin API client for communicating with the Worker.
 *
 * - Only used in Server Components and API Route handlers
 * - Injects X-API-Key header (Key B) automatically
 * - Parses the { data, meta } / { error } response envelope
 * - Throws AdminApiError on non-2xx responses
 */

import "server-only";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getWorkerUrl(): string {
	const url = process.env.WORKER_API_URL;
	if (!url) throw new Error("WORKER_API_URL environment variable is not set");
	return url.replace(/\/+$/, ""); // strip trailing slashes
}

function getApiKey(): string {
	const key = process.env.ADMIN_API_KEY;
	if (!key) throw new Error("ADMIN_API_KEY environment variable is not set");
	return key;
}

// ---------------------------------------------------------------------------
// Error type (thin subclass keeps instanceof / .name distinct from ForumApiError)
// ---------------------------------------------------------------------------

import { ApiError, type ApiErrorData } from "@ellie/shared";

export type AdminApiErrorData = ApiErrorData;

export class AdminApiError extends ApiError {
	constructor(status: number, data: ApiErrorData);
	constructor(status: number, code: string, message: string);
	constructor(status: number, dataOrCode: ApiErrorData | string, message?: string) {
		if (typeof dataOrCode === "string") {
			super(status, dataOrCode, message ?? "");
		} else {
			super(status, dataOrCode);
		}
		this.name = "AdminApiError";
	}
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface PaginationMeta {
	total: number;
	page: number;
	limit: number;
	pages: number;
}

export interface ApiMeta {
	timestamp: number;
	requestId: string;
}

export interface ApiResponse<T> {
	data: T;
	meta: ApiMeta;
}

export interface PaginatedResponse<T> {
	data: T[];
	meta: ApiMeta & PaginationMeta;
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
): Promise<{ data: T; meta: ApiMeta & Partial<PaginationMeta>; status: number }> {
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
	});

	// Parse response body
	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		throw new AdminApiError(res.status, {
			code: "PARSE_ERROR",
			message: `Failed to parse Worker response: ${text.slice(0, 200)}`,
		});
	}

	// Error responses
	if (!res.ok) {
		const errorData = json.error as AdminApiErrorData | undefined;
		throw new AdminApiError(
			res.status,
			errorData ?? { code: "UNKNOWN", message: `Worker returned ${res.status}` },
		);
	}

	return {
		data: json.data as T,
		meta: (json.meta ?? {}) as ApiMeta & Partial<PaginationMeta>,
		status: res.status,
	};
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

export const adminApi = {
	async get<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "GET", path, searchParams });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async getList<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<PaginatedResponse<T>> {
		const result = await request<T[]>({ method: "GET", path, searchParams });
		return { data: result.data, meta: result.meta as ApiMeta & PaginationMeta };
	},

	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "POST", path, body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "PATCH", path, body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async delete<T = void>(path: string): Promise<ApiResponse<T>> {
		const result = await request<T>({ method: "DELETE", path });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/**
	 * Raw request — for endpoints that need custom handling (e.g., passthrough).
	 * Returns the raw fetch Response. Optional `extraHeaders` lets the caller
	 * inject audit headers (D4-b: X-Admin-Actor-Email/Name for purge).
	 */
	async raw(
		method: string,
		path: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Promise<Response> {
		const url = new URL(path, getWorkerUrl());
		const headers: Record<string, string> = {
			"X-API-Key": getApiKey(),
		};
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		if (extraHeaders) {
			for (const [k, v] of Object.entries(extraHeaders)) {
				headers[k] = v;
			}
		}
		return fetch(url.toString(), {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	},
};

// ---------------------------------------------------------------------------
// Actor-bound client — F1 audit logging + G.2 client-IP propagation.
//
// `adminApiAs(admin, request?)` returns a thin wrapper that pre-binds:
//   * Audit headers `X-Admin-Actor-Email` / `X-Admin-Actor-Name` on every
//     mutation call (POST/PUT/PATCH/DELETE). GET/HEAD intentionally skip the
//     audit headers so read-only proxy calls don't carry operator identity
//     into the admin audit log.
//   * `X-Real-IP` on EVERY method (including GET) when `request` is provided.
//     The Worker's trust ladder accepts `X-Real-IP` only when the request
//     carries Key A or Key B (`isServerToWorkerRequest`); the admin BFF
//     always uses Key B, so this is the channel by which Worker handlers see
//     the operator's real IP for both reads (online-tracking, audit) and
//     writes (admin_logs row IP).
//
// Use case (admin route handler):
//   const api = adminApiAs(admin, request);
//   const res = await api.raw("POST", `/api/admin/users/${id}/purge`, body);
//
// The wrapper purposely re-uses `adminApi.raw` so the underlying auth/key
// plumbing stays in one place. Each method merges caller-supplied
// extraHeaders on top of the actor / IP headers (caller wins on conflict).
// ---------------------------------------------------------------------------

import { extractClientIp } from "./client-ip";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ActorIdentity {
	email: string;
	name: string;
}

export interface AdminApiClient {
	raw(
		method: string,
		path: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Promise<Response>;
}

export function adminApiAs(actor: ActorIdentity, request?: Request): AdminApiClient {
	const realIp = request ? extractClientIp(request) : "";
	return {
		async raw(
			method: string,
			path: string,
			body?: unknown,
			extraHeaders?: Record<string, string>,
		): Promise<Response> {
			const upper = method.toUpperCase();
			const merged: Record<string, string> = { ...(extraHeaders ?? {}) };
			if (MUTATION_METHODS.has(upper)) {
				// Caller-supplied headers win on conflict — but normal callers
				// should NOT override these.
				if (merged["X-Admin-Actor-Email"] === undefined) {
					merged["X-Admin-Actor-Email"] = actor.email;
				}
				if (merged["X-Admin-Actor-Name"] === undefined) {
					merged["X-Admin-Actor-Name"] = actor.name;
				}
			}
			if (realIp && merged["X-Ellie-Client-IP"] === undefined) {
				merged["X-Ellie-Client-IP"] = realIp;
			}
			return adminApi.raw(method, path, body, merged);
		},
	};
}
