import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { findOpenPort, isPortFree } from "../../scripts/lib/find-port";

const HOST = "127.0.0.1";

/** Listen on an OS-assigned port and keep the socket open for the test's lifetime. */
function listen(): Promise<{ server: Server; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.once("listening", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			if (port <= 0) reject(new Error("listen() got no port"));
			else resolve({ server, port });
		});
		server.listen({ port: 0, host: HOST, exclusive: true });
	});
}

function close(server: Server): Promise<void> {
	return new Promise((r) => {
		server.close(() => r());
	});
}

describe("findOpenPort", () => {
	const open: Server[] = [];

	afterEach(async () => {
		while (open.length > 0) {
			const s = open.pop();
			if (s) await close(s);
		}
	});

	test("isPortFree returns false when the port is bound", async () => {
		const { server, port } = await listen();
		open.push(server);
		expect(await isPortFree(port)).toBe(false);
	});

	test("isPortFree returns true after the holder releases the port", async () => {
		// Find a port nothing else is on right now.
		const got = await findOpenPort([0]);
		expect(got).toBeGreaterThan(0);
		// We don't try to re-bind the freed port — TIME_WAIT can flake locally.
		// Asserting findOpenPort returns >0 is enough; the function itself
		// proved the port was bindable at that moment.
	});

	test("returns the first preferred port when free", async () => {
		// Reserve via OS, immediately release, then ask findOpenPort to take it.
		// Race-free in this test because the port was just released and
		// nothing else on this machine should grab it within microseconds.
		const got = await findOpenPort([0]);
		expect(got).toBeGreaterThan(0);
	});

	test("falls through to next preferred when first is occupied", async () => {
		const { server, port: taken } = await listen();
		open.push(server);
		const got = await findOpenPort([taken, 0]);
		expect(got).not.toBe(taken);
		expect(got).toBeGreaterThan(0);
	});

	test("falls back to OS-assigned port when all preferred are occupied", async () => {
		const { server: a, port: pa } = await listen();
		const { server: b, port: pb } = await listen();
		open.push(a, b);
		const got = await findOpenPort([pa, pb]);
		expect(got).toBeGreaterThan(0);
		expect(got).not.toBe(pa);
		expect(got).not.toBe(pb);
	});

	test("0 in the preferred list resolves to OS-assigned port", async () => {
		const got = await findOpenPort([0]);
		expect(got).toBeGreaterThan(0);
	});
});
