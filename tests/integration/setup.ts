// tests/integration/setup.ts — L2 integration test infrastructure
// Ref: 04b §六维质量体系 — L2 Integration: 真 HTTP, 100% API 端点覆盖
//
// Auto-starts Next.js dev server on port 13000 before tests,
// waits for it to be ready, and kills it after tests complete.

import { type Subprocess, spawn } from "bun";

const PORT = 13000;
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT = 30_000; // 30s max for server startup

let serverProcess: Subprocess | null = null;

/**
 * Base URL for integration tests.
 */
export function getBaseUrl(): string {
	return BASE_URL;
}

/**
 * Make a fetch request to the dev server.
 * Convenience wrapper that prepends the base URL.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${BASE_URL}${path}`, init);
}

/**
 * Default mock auth headers — simulate an authenticated regular user.
 * Proxy requires X-Mock-Uid on non-public routes.
 */
export const DEFAULT_AUTH_HEADERS: Record<string, string> = {
	"X-Mock-Uid": "1",
};

/**
 * Make a JSON POST request to the dev server.
 * Includes default auth headers (X-Mock-Uid) so proxy allows the request.
 */
export async function apiPost(
	path: string,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
): Promise<Response> {
	return fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...DEFAULT_AUTH_HEADERS,
			...headers,
		},
		body: JSON.stringify(body),
	});
}

/**
 * Make a DELETE request to the dev server.
 * Includes default auth headers (X-Mock-Uid) so proxy allows the request.
 */
export async function apiDelete(path: string, headers?: Record<string, string>): Promise<Response> {
	return fetch(`${BASE_URL}${path}`, {
		method: "DELETE",
		headers: {
			...DEFAULT_AUTH_HEADERS,
			...headers,
		},
	});
}

/**
 * Wait for the dev server to respond on the given port.
 */
async function waitForServer(timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const response = await fetch(`${BASE_URL}/api/v1/forums`);
			if (response.ok) return;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Dev server did not start within ${timeoutMs}ms`);
}

/**
 * Start the Next.js dev server.
 * Call in beforeAll() of integration test suites.
 */
export async function startServer(): Promise<void> {
	if (serverProcess) return; // Already running

	// Check if port is already in use (another dev server)
	try {
		const response = await fetch(`${BASE_URL}/api/v1/forums`);
		if (response.ok) {
			// Server already running externally — skip spawn
			console.log(`[L2] Dev server already running on port ${PORT}`);
			return;
		}
	} catch {
		// Port not in use — we need to start the server
	}

	console.log(`[L2] Starting dev server on port ${PORT}...`);
	serverProcess = spawn(["bun", "run", "dev", "--port", String(PORT)], {
		cwd: process.cwd(),
		stdout: "ignore",
		stderr: "ignore",
		env: {
			...process.env,
			PORT: String(PORT),
			NODE_ENV: "development",
			AUTH_SECRET: "integration-test-secret-key-at-least-32-chars",
		},
	});

	await waitForServer(STARTUP_TIMEOUT);
	console.log(`[L2] Dev server ready on port ${PORT}`);
}

/**
 * Stop the dev server.
 * Call in afterAll() of integration test suites.
 */
export async function stopServer(): Promise<void> {
	if (!serverProcess) return;
	console.log("[L2] Stopping dev server...");
	serverProcess.kill();
	serverProcess = null;
}
