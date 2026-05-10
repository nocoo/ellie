/**
 * Browser-side forum API client — the single HTTP entry point for any code
 * that runs in the browser (client components, hooks, viewmodel facades).
 *
 * Targets same-origin Next.js `/api/*` proxy routes; the Next route layer
 * forwards to the Worker with Key A + JWT injection. No env vars required
 * here, no `server-only` import — safe to bundle into client components.
 *
 * Phase A (network-layer abstraction) requires every browser network call
 * to go through the methods exported from this module. A static guard
 * (`tests/unit/architecture/no-raw-fetch.test.ts`) enforces this for
 * `apps/web/src/`.
 *
 * Surface:
 *   - JSON envelope helpers (`get`, `getList`, `post`, `patch`, `put`,
 *     `delete`) — assume the wrapped `{ data, meta }` envelope.
 *   - `getRaw` — for legacy Next routes that respond with bare JSON
 *     (e.g. `/api/auth/check-username`, `/api/v1/settings`).
 *   - `upload` — multipart/form-data; intentionally does NOT set
 *     Content-Type so the browser fills in the correct boundary.
 *
 * All paths share one parser (`readJson`) and one error path
 * (`throwForErrorBody`) so §5.4 EMAIL_NOT_VERIFIED dispatch +
 * ApiError(rawBody) semantics never diverge between method variants.
 */

// ---------------------------------------------------------------------------
// Error type (imported from shared module, re-exported for backward compatibility)
// ---------------------------------------------------------------------------

import {
	dispatchEmailNotVerified,
	isEmailNotVerifiedPayloadClient,
	pickDialogPayload,
} from "@/viewmodels/forum/email-not-verified-dispatch";
import { ApiError } from "./api-error";
export { ApiError };

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

export interface RequestOptions {
	signal?: AbortSignal;
}

type SearchParams = Record<string, string | number | boolean | undefined | null>;

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
	if (typeof window !== "undefined") return window.location.origin;
	return "";
}

function buildUrl(path: string, searchParams?: SearchParams): string {
	const url = new URL(path, getBaseUrl() || "http://localhost");
	if (searchParams) {
		for (const [key, value] of Object.entries(searchParams)) {
			if (value !== undefined && value !== null && value !== "") {
				url.searchParams.set(key, String(value));
			}
		}
	}
	return url.toString();
}

/**
 * Parse a Response into JSON, throwing PARSE_ERROR on malformed bodies.
 * Returns `{}` for empty bodies to match historical behavior.
 */
async function readJson(res: Response): Promise<Record<string, unknown>> {
	const text = await res.text();
	try {
		return text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		throw new ApiError(
			res.status,
			"PARSE_ERROR",
			`Failed to parse response: ${text.slice(0, 200)}`,
		);
	}
}

/**
 * Throw ApiError for non-2xx responses, with §5.4 EMAIL_NOT_VERIFIED
 * dispatch sequenced before the wrapped-error fallback. Centralised so
 * every method (JSON envelope, raw JSON, multipart upload) shares the
 * same error semantics.
 */
function throwForErrorBody(status: number, json: Record<string, unknown>): never {
	// docs/17 §5.4 — Worker write-route gates emit a flat
	// `{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }` body.
	// Detect BEFORE the wrapped path because `error` is a string here.
	if (isEmailNotVerifiedPayloadClient(json)) {
		dispatchEmailNotVerified(pickDialogPayload(json));
		const err = new ApiError(status, "EMAIL_NOT_VERIFIED", json.message as string);
		err.rawBody = json;
		throw err;
	}
	const error = json.error as { code?: string; message?: string } | undefined;
	const err = new ApiError(
		status,
		error?.code ?? "UNKNOWN",
		error?.message ?? `Request failed with status ${status}`,
	);
	err.rawBody = json;
	throw err;
}

interface RequestInternalOpts {
	body?: unknown;
	searchParams?: SearchParams;
	signal?: AbortSignal;
}

async function requestEnvelope<T>(
	method: string,
	path: string,
	opts?: RequestInternalOpts,
): Promise<{ data: T; meta: ApiMeta & Partial<PaginationMeta> }> {
	const url = buildUrl(path, opts?.searchParams);

	const headers: Record<string, string> = {};
	if (opts?.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url, {
		method,
		headers,
		body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
		signal: opts?.signal,
	});

	const json = await readJson(res);
	if (!res.ok) throwForErrorBody(res.status, json);

	return {
		data: json.data as T,
		meta: (json.meta ?? {}) as ApiMeta & Partial<PaginationMeta>,
	};
}

async function requestRaw<T>(method: string, path: string, opts?: RequestInternalOpts): Promise<T> {
	const url = buildUrl(path, opts?.searchParams);

	const headers: Record<string, string> = {};
	if (opts?.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url, {
		method,
		headers,
		body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
		signal: opts?.signal,
	});

	const json = await readJson(res);
	if (!res.ok) throwForErrorBody(res.status, json);

	return json as unknown as T;
}

async function requestUpload<T>(
	path: string,
	formData: FormData,
	opts?: RequestOptions,
): Promise<{ data: T; meta: ApiMeta & Partial<PaginationMeta> }> {
	const url = buildUrl(path);

	// Intentionally do NOT set Content-Type — the browser must add the
	// multipart boundary. Setting it manually breaks the upload.
	const res = await fetch(url, {
		method: "POST",
		body: formData,
		signal: opts?.signal,
	});

	const json = await readJson(res);
	if (!res.ok) throwForErrorBody(res.status, json);

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
		searchParams?: SearchParams,
		opts?: RequestOptions,
	): Promise<ApiResponse<T>> {
		const result = await requestEnvelope<T>("GET", path, {
			searchParams,
			signal: opts?.signal,
		});
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async getList<T>(
		path: string,
		searchParams?: SearchParams,
		opts?: RequestOptions,
	): Promise<PaginatedResponse<T>> {
		const result = await requestEnvelope<T[]>("GET", path, {
			searchParams,
			signal: opts?.signal,
		});
		return { data: result.data, meta: result.meta as ApiMeta & PaginationMeta };
	},

	async post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>> {
		const result = await requestEnvelope<T>("POST", path, { body, signal: opts?.signal });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async patch<T>(path: string, body: unknown, opts?: RequestOptions): Promise<ApiResponse<T>> {
		const result = await requestEnvelope<T>("PATCH", path, { body, signal: opts?.signal });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async put<T>(path: string, body: unknown, opts?: RequestOptions): Promise<ApiResponse<T>> {
		const result = await requestEnvelope<T>("PUT", path, { body, signal: opts?.signal });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	async delete<T = void>(path: string, opts?: RequestOptions): Promise<ApiResponse<T>> {
		const result = await requestEnvelope<T>("DELETE", path, { signal: opts?.signal });
		return { data: result.data, meta: result.meta as ApiMeta };
	},

	/**
	 * GET a Next route that responds with bare JSON (no `{data,meta}` envelope).
	 * Used for routes that pre-date envelope conventions
	 * (`/api/auth/check-username`, `/api/v1/settings`).
	 *
	 * Error handling reuses the same `throwForErrorBody` path as envelope
	 * methods, so §5.4 dispatch and ApiError shape never diverge.
	 */
	async getRaw<T>(path: string, searchParams?: SearchParams, opts?: RequestOptions): Promise<T> {
		return requestRaw<T>("GET", path, { searchParams, signal: opts?.signal });
	},

	/**
	 * multipart/form-data POST. Browser sets the Content-Type boundary —
	 * do not override.
	 */
	async upload<T>(
		path: string,
		formData: FormData,
		opts?: RequestOptions,
	): Promise<ApiResponse<T>> {
		const result = await requestUpload<T>(path, formData, opts);
		return { data: result.data, meta: result.meta as ApiMeta };
	},
};
