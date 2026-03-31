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
// Error type (imported from shared module, re-exported for backward compatibility)
// ---------------------------------------------------------------------------

import { ApiError as AdminApiError, type ApiErrorData as AdminApiErrorData } from "./api-error";
export { AdminApiError, type AdminApiErrorData };

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
	 * Returns the raw fetch Response.
	 */
	async raw(method: string, path: string, body?: unknown): Promise<Response> {
		const url = new URL(path, getWorkerUrl());
		const headers: Record<string, string> = {
			"X-API-Key": getApiKey(),
		};
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		return fetch(url.toString(), {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	},
};
