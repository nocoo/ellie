// tests/integration/setup.ts — L2 integration test infrastructure
// Ref: 04b §六维质量体系 — L2 Integration: 真 HTTP, 100% Worker API 端点覆盖
//
// The Worker is started externally by scripts/run-l2.ts on the port given
// via process.env.L2_PORT. This module only provides URL/auth helpers and
// a thin readiness check.

// ─── Configuration ─────────────────────────────────────────────

/**
 * Worker port. Defaults to 17031 (nmem 万位档 1 = project main 7031 + 10000)
 * so direct `bun test tests/integration/http/...` invocations (no runner)
 * still hit the right port. scripts/run-l2.ts overrides this via L2_PORT
 * when it falls back to an anonymous port due to a collision.
 */
const WORKER_PORT = Number(process.env.L2_PORT ?? "17031");
const WORKER_URL = `http://localhost:${WORKER_PORT}`;
const READINESS_TIMEOUT_MS = 5_000;

/**
 * Get API Key A (public API) from environment.
 * Must be a function to support late binding after preload sets process.env.
 */
export function getApiKeyA(): string {
	return process.env.API_KEY || "test-api-key";
}

/**
 * Get API Key B (admin API) from environment.
 */
export function getApiKeyB(): string {
	return process.env.ADMIN_API_KEY || "test-admin-api-key";
}

/**
 * Get JWT secret from environment.
 */
export function getJwtSecret(): string {
	return process.env.JWT_SECRET || "test-secret-key-for-jwt-hs256";
}

/** @deprecated Use getApiKeyA() instead — this may have stale value if preload hasn't run */
export const API_KEY_A = "DEPRECATED_USE_getApiKeyA";
/** @deprecated Use getApiKeyB() instead */
export const API_KEY_B = "DEPRECATED_USE_getApiKeyB";
/** @deprecated Use getJwtSecret() instead */
export const JWT_SECRET = "DEPRECATED_USE_getJwtSecret";

let workerReadyPromise: Promise<void> | null = null;

// ─── URL Helpers ───────────────────────────────────────────────

/**
 * Base URL for Worker integration tests.
 */
export function getWorkerUrl(): string {
	return WORKER_URL;
}

// ─── JWT Generation ────────────────────────────────────────────

/**
 * Create a JWT token for testing authenticated endpoints.
 * Must match apps/worker/src/lib/jwt.ts exactly.
 */
export async function createTestJwt(
	userId: number,
	role: number,
	expiresInSec = 3600,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "HS256", typ: "JWT" };
	const payload = {
		userId,
		role,
		exp: now + expiresInSec,
		iat: now,
	};

	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));

	const data = `${encodedHeader}.${encodedPayload}`;
	const signature = await sign(data, getJwtSecret());
	const encodedSignature = base64UrlEncode(signature);

	return `${data}.${encodedSignature}`;
}

/**
 * Signs data using HMAC-SHA256 (matches Worker implementation).
 */
async function sign(data: string, secret: string): Promise<Uint8Array> {
	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
	return new Uint8Array(signature);
}

/**
 * Encodes a string or bytes to base64url format (matches Worker implementation).
 */
function base64UrlEncode(input: string | Uint8Array): string {
	let bytes: Uint8Array;
	if (typeof input === "string") {
		bytes = new TextEncoder().encode(input);
	} else {
		bytes = input;
	}

	const base64 = btoa(String.fromCharCode(...bytes));
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─── Worker Fetch Utilities ────────────────────────────────────

/**
 * Fetch from Worker with Key A (public API).
 */
export async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		...init,
		headers: {
			"X-API-Key": getApiKeyA(),
			...init?.headers,
		},
	});
}

/**
 * Fetch from Worker with Key A + JWT auth.
 */
export async function workerAuthFetch(
	path: string,
	jwt: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		...init,
		headers: {
			"X-API-Key": getApiKeyA(),
			Authorization: `Bearer ${jwt}`,
			...init?.headers,
		},
	});
}

/**
 * POST JSON to Worker with Key A.
 */
export async function workerPost(
	path: string,
	body: Record<string, unknown>,
	jwt?: string,
): Promise<Response> {
	const headers: Record<string, string> = {
		"X-API-Key": getApiKeyA(),
		"Content-Type": "application/json",
	};
	if (jwt) headers.Authorization = `Bearer ${jwt}`;

	return fetch(`${WORKER_URL}${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

/**
 * PATCH JSON to Worker with Key A.
 */
export async function workerPatch(
	path: string,
	body: Record<string, unknown>,
	jwt?: string,
): Promise<Response> {
	const headers: Record<string, string> = {
		"X-API-Key": getApiKeyA(),
		"Content-Type": "application/json",
	};
	if (jwt) headers.Authorization = `Bearer ${jwt}`;

	return fetch(`${WORKER_URL}${path}`, {
		method: "PATCH",
		headers,
		body: JSON.stringify(body),
	});
}

/**
 * DELETE to Worker with Key A.
 */
export async function workerDelete(path: string, jwt?: string): Promise<Response> {
	const headers: Record<string, string> = {
		"X-API-Key": getApiKeyA(),
	};
	if (jwt) headers.Authorization = `Bearer ${jwt}`;

	return fetch(`${WORKER_URL}${path}`, {
		method: "DELETE",
		headers,
	});
}

// ─── Admin API Utilities (Key B) ───────────────────────────────

/**
 * Fetch from Worker with Key B (admin API).
 */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		...init,
		headers: {
			"X-API-Key": getApiKeyB(),
			...init?.headers,
		},
	});
}

/**
 * GET from admin API.
 */
export async function adminGet(path: string): Promise<Response> {
	return adminFetch(path);
}

/**
 * POST JSON to admin API.
 */
export async function adminPost(path: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "POST",
		headers: {
			"X-API-Key": getApiKeyB(),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

/**
 * PATCH JSON to admin API.
 */
export async function adminPatch(path: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "PATCH",
		headers: {
			"X-API-Key": getApiKeyB(),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

/**
 * PUT JSON to admin API.
 */
export async function adminPut(path: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "PUT",
		headers: {
			"X-API-Key": getApiKeyB(),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

/**
 * DELETE to admin API.
 */
export async function adminDelete(path: string): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "DELETE",
		headers: {
			"X-API-Key": getApiKeyB(),
		},
	});
}

// ─── Server Lifecycle ──────────────────────────────────────────

/**
 * Confirm the externally-managed Worker is reachable. Worker startup is
 * owned by scripts/run-l2.ts; this helper only verifies that the dev
 * server is up so tests fail fast with a clear error otherwise.
 */
export async function startWorker(): Promise<void> {
	if (workerReadyPromise) return workerReadyPromise;

	workerReadyPromise = (async () => {
		const start = Date.now();
		while (Date.now() - start < READINESS_TIMEOUT_MS) {
			try {
				const response = await fetch(`${WORKER_URL}/api/live`);
				if (response.ok) {
					console.log(`[L2] Worker reachable on port ${WORKER_PORT}`);
					return;
				}
			} catch {
				// not ready yet
			}
			await new Promise((r) => setTimeout(r, 200));
		}
		throw new Error(
			`[L2] Worker not reachable on port ${WORKER_PORT}. Run integration tests via \`bun run test:e2e:api\` (scripts/run-l2.ts).`,
		);
	})();

	return workerReadyPromise;
}

/**
 * No-op: Worker lifecycle is owned by scripts/run-l2.ts.
 * Kept for backward compatibility with any test that calls it in afterAll.
 */
export async function stopWorker(): Promise<void> {
	workerReadyPromise = null;
}

// ─── Legacy exports (for backward compatibility during migration) ───

/** @deprecated Use getWorkerUrl() instead */
export function getBaseUrl(): string {
	return WORKER_URL;
}

/** @deprecated Use workerFetch() instead */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return workerFetch(path, init);
}

/** @deprecated Use workerPost() instead */
export async function apiPost(
	path: string,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-Key": getApiKeyA(),
			...headers,
		},
		body: JSON.stringify(body),
	});
}

/** @deprecated Use workerPatch() instead */
export async function apiPatch(
	path: string,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			"X-API-Key": getApiKeyA(),
			...headers,
		},
		body: JSON.stringify(body),
	});
}

/** @deprecated Use workerDelete() instead */
export async function apiDelete(path: string, headers?: Record<string, string>): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		method: "DELETE",
		headers: {
			"X-API-Key": getApiKeyA(),
			...headers,
		},
	});
}

/** @deprecated No longer needed — Worker tests use real JWT */
export function getDefaultAuthHeaders(): Record<string, string> {
	return { "X-API-Key": getApiKeyA() };
}

/** @deprecated Use getDefaultAuthHeaders() instead */
export const DEFAULT_AUTH_HEADERS: Record<string, string> = {
	"X-API-Key": "DEPRECATED_USE_getDefaultAuthHeaders",
};

/** @deprecated Use startWorker() instead */
export const startServer = startWorker;

/** @deprecated Use stopWorker() instead */
export const stopServer = stopWorker;
