import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type GuardedPlaywrightDeps,
	runPlaywrightGuarded,
} from "../../scripts/lib/run-playwright-guarded";

type FakeChild = EventEmitter & {
	pid: number;
	killed?: boolean;
};

function makeChild(pid = 4242): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.pid = pid;
	return child;
}

describe("runPlaywrightGuarded", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not abort on a single transient health failure", async () => {
		const child = makeChild();
		const killTree = vi.fn(async () => {
			child.emit("exit", 1, null);
		});
		const health = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValue(true);

		const deps: GuardedPlaywrightDeps = {
			spawnDetached: () => child as never,
			killTree: killTree as never,
			delay: async () => {},
		};

		const resultPromise = runPlaywrightGuarded(
			{
				args: ["-c", "playwright.config.ts"],
				cwd: process.cwd(),
				env: process.env,
				isWorkerHealthy: health,
				pollMs: 10,
				consecutiveFailures: 2,
			},
			deps,
		);

		// Let the monitor loop observe one failure then recover, then exit cleanly.
		await Promise.resolve();
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 30));
		child.emit("exit", 0, null);

		const result = await resultPromise;
		expect(result).toEqual({ kind: "exit", code: 0 });
		expect(killTree).not.toHaveBeenCalled();
		expect(health.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("kills once after consecutive failures and returns worker-aborted", async () => {
		const child = makeChild();
		const killTree = vi.fn(async () => {
			// Simulate tree-kill completing the process.
			queueMicrotask(() => child.emit("exit", 1, "SIGTERM"));
		});
		const health = vi.fn(async () => false);

		const deps: GuardedPlaywrightDeps = {
			spawnDetached: () => child as never,
			killTree: killTree as never,
			delay: async () => {},
		};

		const result = await runPlaywrightGuarded(
			{
				args: ["-c", "playwright.config.ts"],
				cwd: process.cwd(),
				env: process.env,
				isWorkerHealthy: health,
				pollMs: 5,
				consecutiveFailures: 2,
			},
			deps,
		);

		expect(result.kind).toBe("worker-aborted");
		if (result.kind === "worker-aborted") {
			expect(result.reason).toMatch(/consecutive probe failures/);
		}
		expect(killTree).toHaveBeenCalledTimes(1);
		// At least two failed probes before kill.
		expect(health.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("stops monitoring after a normal Playwright exit", async () => {
		const child = makeChild();
		let healthCalls = 0;
		const health = vi.fn(async () => {
			healthCalls += 1;
			return true;
		});
		const killTree = vi.fn(async () => {});

		const deps: GuardedPlaywrightDeps = {
			spawnDetached: () => child as never,
			killTree: killTree as never,
			delay: async () => {},
		};

		const resultPromise = runPlaywrightGuarded(
			{
				args: [],
				cwd: process.cwd(),
				env: process.env,
				isWorkerHealthy: health,
				pollMs: 5,
				consecutiveFailures: 2,
			},
			deps,
		);

		// Exit quickly on a clean run.
		await new Promise((r) => setTimeout(r, 12));
		const callsAtExit = healthCalls;
		child.emit("exit", 0, null);
		const result = await resultPromise;

		expect(result).toEqual({ kind: "exit", code: 0 });
		expect(killTree).not.toHaveBeenCalled();

		// Give the event loop a beat — monitor must not keep probing.
		await new Promise((r) => setTimeout(r, 30));
		expect(healthCalls).toBe(callsAtExit);
	});
});
