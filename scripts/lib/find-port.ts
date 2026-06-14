/**
 * find-port — pick an available TCP port for local test runners.
 *
 * Used by run-l2.ts / run-l3.ts / run-l3-admin.ts to align with the
 * nmem port convention (project main port + N×10000) but stay robust
 * when the preferred port is occupied by another local dev process.
 *
 * Strategy: try each preferred port in order; return the first free one.
 * If none are free, ask the OS for an anonymous ephemeral port via
 * `port: 0` so the runner still starts (better than crashing). Callers
 * should log the chosen port so collisions are visible.
 *
 * Implementation note: we use Node's built-in `node:net` rather than
 * `Bun.listen` so this helper works under both Bun (production runner)
 * and Vitest (Node, used by tests/unit/find-port.test.ts).
 */
import { createServer } from "node:net";

export async function isPortFree(port: number, hostname = "127.0.0.1"): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		try {
			server.listen({ port, host: hostname, exclusive: true });
		} catch {
			resolve(false);
		}
	});
}

async function reserveAnonymousPort(hostname = "127.0.0.1"): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.once("listening", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			server.close(() => {
				if (port > 0) resolve(port);
				else reject(new Error("could not allocate anonymous port"));
			});
		});
		server.listen({ port: 0, host: hostname, exclusive: true });
	});
}

/**
 * Pick an open port from the preferred list. If every preferred port is
 * occupied, fall back to an OS-assigned ephemeral port. The list may
 * include `0` explicitly to request the OS-assigned fallback inline.
 */
export async function findOpenPort(
	prefer: readonly number[],
	hostname = "127.0.0.1",
): Promise<number> {
	for (const p of prefer) {
		if (p === 0) return reserveAnonymousPort(hostname);
		if (await isPortFree(p, hostname)) return p;
	}
	return reserveAnonymousPort(hostname);
}
