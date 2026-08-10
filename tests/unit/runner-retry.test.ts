import { afterEach, describe, expect, it } from "vitest";
import {
	classifyTestExit,
	parseAttempts,
	type RunnerOutcome,
	runWithRetries,
} from "../../scripts/lib/runner-retry";

describe("parseAttempts", () => {
	const original = process.env.L3_ATTEMPTS;

	afterEach(() => {
		if (original === undefined) delete process.env.L3_ATTEMPTS;
		else process.env.L3_ATTEMPTS = original;
	});

	it("defaults to 3 when unset", () => {
		delete process.env.L3_ATTEMPTS;
		expect(parseAttempts("L3_ATTEMPTS")).toBe(3);
	});

	it("parses a positive integer", () => {
		process.env.L3_ATTEMPTS = "2";
		expect(parseAttempts("L3_ATTEMPTS")).toBe(2);
	});

	it("falls back on non-integer values", () => {
		process.env.L3_ATTEMPTS = "nope";
		expect(parseAttempts("L3_ATTEMPTS")).toBe(3);
	});

	it("falls back on zero or negative", () => {
		process.env.L3_ATTEMPTS = "0";
		expect(parseAttempts("L3_ATTEMPTS")).toBe(3);
		process.env.L3_ATTEMPTS = "-1";
		expect(parseAttempts("L3_ATTEMPTS")).toBe(3);
	});
});

describe("classifyTestExit", () => {
	it("returns success on exit 0", async () => {
		const outcome = await classifyTestExit({
			exitCode: 0,
			hasExited: () => true,
			exitCodeOfWorker: () => 1,
			isAlive: async () => false,
		});
		expect(outcome).toEqual({ kind: "success" });
	});

	it("classifies process exit as worker-failure", async () => {
		const outcome = await classifyTestExit({
			exitCode: 1,
			hasExited: () => true,
			exitCodeOfWorker: () => 137,
			isAlive: async () => false,
		});
		expect(outcome).toEqual({
			kind: "worker-failure",
			reason: "worker died during tests (exit code 137)",
		});
	});

	it("classifies unresponsive /api/live as worker-failure", async () => {
		const outcome = await classifyTestExit({
			exitCode: 1,
			hasExited: () => false,
			exitCodeOfWorker: () => null,
			isAlive: async () => false,
		});
		expect(outcome).toEqual({
			kind: "worker-failure",
			reason: "worker stopped responding to /api/live mid-run",
		});
	});

	it("classifies alive worker + non-zero exit as test-failure", async () => {
		const outcome = await classifyTestExit({
			exitCode: 2,
			hasExited: () => false,
			exitCodeOfWorker: () => null,
			isAlive: async () => true,
		});
		expect(outcome).toEqual({ kind: "test-failure", exitCode: 2 });
	});
});

describe("runWithRetries", () => {
	it("retries worker-failure then succeeds", async () => {
		const calls: number[] = [];
		const cleanups: number[] = [];
		const exitCode = await runWithRetries({
			label: "unit",
			totalAttempts: 3,
			retryDelayMs: 0,
			runOnce: async (attempt) => {
				calls.push(attempt);
				if (attempt < 2) {
					return { kind: "worker-failure", reason: "boom" } satisfies RunnerOutcome;
				}
				return { kind: "success" };
			},
			cleanup: async () => {
				cleanups.push(calls.length);
			},
		});
		expect(exitCode).toBe(0);
		expect(calls).toEqual([1, 2]);
		expect(cleanups).toEqual([1, 2]);
	});

	it("does not retry setup-failure", async () => {
		const calls: number[] = [];
		const exitCode = await runWithRetries({
			label: "unit",
			totalAttempts: 3,
			retryDelayMs: 0,
			runOnce: async (attempt) => {
				calls.push(attempt);
				return { kind: "setup-failure", reason: "migrate failed" };
			},
			cleanup: async () => {},
		});
		expect(exitCode).toBe(1);
		expect(calls).toEqual([1]);
	});

	it("does not retry test-failure", async () => {
		const calls: number[] = [];
		const exitCode = await runWithRetries({
			label: "unit",
			totalAttempts: 3,
			retryDelayMs: 0,
			runOnce: async (attempt) => {
				calls.push(attempt);
				return { kind: "test-failure", exitCode: 7 };
			},
			cleanup: async () => {},
		});
		expect(exitCode).toBe(7);
		expect(calls).toEqual([1]);
	});

	it("exhausts attempts on persistent worker-failure", async () => {
		const calls: number[] = [];
		const exitCode = await runWithRetries({
			label: "unit",
			totalAttempts: 3,
			retryDelayMs: 0,
			runOnce: async (attempt) => {
				calls.push(attempt);
				return { kind: "worker-failure", reason: "still dead" };
			},
			cleanup: async () => {},
		});
		expect(exitCode).toBe(1);
		expect(calls).toEqual([1, 2, 3]);
	});
});
