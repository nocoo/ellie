/**
 * Client-safe API helper for calling Next.js API routes.
 *
 * Unlike admin-api.ts (server-only), this module uses browser-compatible
 * fetch() targeting the /api/admin/* proxy routes. No env vars required —
 * the proxy handles auth + API key injection.
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
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

interface ApiMeta {
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
// Core request
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
	if (typeof window !== "undefined") return window.location.origin;
	return "";
}

async function request<T>(
	method: string,
	path: string,
	opts?: {
		body?: unknown;
		searchParams?: Record<string, string | number | boolean | undefined | null>;
	},
): Promise<{ data: T; meta: ApiMeta & Partial<PaginationMeta> }> {
	const url = new URL(path, getBaseUrl() || "http://localhost");

	if (opts?.searchParams) {
		for (const [key, value] of Object.entries(opts.searchParams)) {
			if (value !== undefined && value !== null && value !== "") {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const headers: Record<string, string> = {};
	if (opts?.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url.toString(), {
		method,
		headers,
		body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});

	const text = await res.text();
	let json: Record<string, unknown>;
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		throw new ApiError(
			res.status,
			"PARSE_ERROR",
			`Failed to parse response: ${text.slice(0, 200)}`,
		);
	}

	if (!res.ok) {
		const error = json.error as { code?: string; message?: string } | undefined;
		throw new ApiError(
			res.status,
			error?.code ?? "UNKNOWN",
			error?.message ?? `Request failed with status ${res.status}`,
		);
	}

	return {
		data: json.data as T,
		meta: (json.meta ?? {}) as ApiMeta & Partial<PaginationMeta>,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const apiClient = {
	async get<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<ApiResponse<T>> {
		const result = await request<T>("GET", path, { searchParams });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async getList<T>(
		path: string,
		searchParams?: Record<string, string | number | boolean | undefined | null>,
	): Promise<PaginatedResponse<T>> {
		const result = await request<T[]>("GET", path, { searchParams });
		return { data: result.data, meta: result.meta as ApiMeta & PaginationMeta };
	},

	async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>("POST", path, { body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
		const result = await request<T>("PATCH", path, { body });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async delete<T = void>(path: string): Promise<ApiResponse<T>> {
		const result = await request<T>("DELETE", path);
		return { data: result.data, meta: result.meta as ApiMeta };
	},
};
