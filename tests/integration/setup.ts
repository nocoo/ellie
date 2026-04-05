// tests/integration/setup.ts — L2 integration test infrastructure
// Ref: 04b §六维质量体系 — L2 Integration: 真 HTTP, 100% Worker API 端点覆盖
//
// Auto-starts Cloudflare Worker on port 8787 before tests,
// waits for it to be ready, and kills it after tests complete.

import { type Subprocess, spawn } from "bun";

// ─── Configuration ─────────────────────────────────────────────

/** Worker default port (wrangler dev) */
const WORKER_PORT = 8787;
const WORKER_URL = `http://localhost:${WORKER_PORT}`;
const STARTUP_TIMEOUT = 30_000; // 30s max for server startup

/** API Keys — must match .dev.vars */
export const API_KEY_A = process.env.FORUM_API_KEY || "test-api-key";
export const API_KEY_B = process.env.ADMIN_API_KEY || "test-admin-api-key";
export const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key-for-jwt-hs256";

let workerProcess: Subprocess | null = null;

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
 * Replicates the logic from apps/worker/src/lib/jwt.ts
 */
export async function createTestJwt(
	userId: number,
	role: number,
	expiresInSec = 3600,
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };
	const payload = {
		userId,
		role,
		exp: Math.floor(Date.now() / 1000) + expiresInSec,
	};

	const encoder = new TextEncoder();
	const headerB64 = btoa(JSON.stringify(header))
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
	const payloadB64 = btoa(JSON.stringify(payload))
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(JWT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`${headerB64}.${payloadB64}`),
	);

	const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");

	return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// ─── Worker Fetch Utilities ────────────────────────────────────

/**
 * Fetch from Worker with Key A (public API).
 */
export async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${WORKER_URL}${path}`, {
		...init,
		headers: {
			"X-API-Key": API_KEY_A,
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
			"X-API-Key": API_KEY_A,
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
		"X-API-Key": API_KEY_A,
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
		"X-API-Key": API_KEY_A,
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
		"X-API-Key": API_KEY_A,
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
			"X-API-Key": API_KEY_B,
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
			"X-API-Key": API_KEY_B,
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
			"X-API-Key": API_KEY_B,
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
			"X-API-Key": API_KEY_B,
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
			"X-API-Key": API_KEY_B,
		},
	});
}

// ─── Server Lifecycle ──────────────────────────────────────────

/**
 * Wait for the Worker to respond on the health endpoint.
 */
async function waitForWorker(timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const response = await fetch(`${WORKER_URL}/api/live`);
			if (response.ok) return;
		} catch {
			// Worker not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Worker did not start within ${timeoutMs}ms`);
}

/**
 * Start the Cloudflare Worker dev server.
 * Call in beforeAll() of integration test suites.
 */
export async function startWorker(): Promise<void> {
	if (workerProcess) return; // Already running

	// Check if Worker is already running externally
	try {
		const response = await fetch(`${WORKER_URL}/api/live`);
		if (response.ok) {
			console.log(`[L2] Worker already running on port ${WORKER_PORT}`);
			return;
		}
	} catch {
		// Port not in use — we need to start the Worker
	}

	console.log(`[L2] Starting Worker on port ${WORKER_PORT}...`);
	workerProcess = spawn(
		["npx", "wrangler", "dev", "-c", "apps/worker/wrangler.toml", "--port", String(WORKER_PORT)],
		{
			cwd: process.cwd(),
			stdout: "ignore",
			stderr: "ignore",
			env: {
				...process.env,
				NODE_ENV: "development",
			},
		},
	);

	await waitForWorker(STARTUP_TIMEOUT);
	console.log(`[L2] Worker ready on port ${WORKER_PORT}`);
}

/**
 * Stop the Worker dev server.
 * Call in afterAll() of integration test suites.
 */
export async function stopWorker(): Promise<void> {
	if (!workerProcess) return;
	console.log("[L2] Stopping Worker...");
	workerProcess.kill();
	workerProcess = null;
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
			"X-API-Key": API_KEY_A,
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
			"X-API-Key": API_KEY_A,
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
			"X-API-Key": API_KEY_A,
			...headers,
		},
	});
}

/** @deprecated No longer needed — Worker tests use real JWT */
export const DEFAULT_AUTH_HEADERS: Record<string, string> = {
	"X-API-Key": API_KEY_A,
};

/** @deprecated Use startWorker() instead */
export const startServer = startWorker;

/** @deprecated Use stopWorker() instead */
export const stopServer = stopWorker;
