/**
 * Shared attempt/retry helpers for local wrangler test runners (L2/L3).
 *
 * Retries only transient worker/workerd failures. Real setup errors and
 * assertion regressions (worker still alive after a non-zero test exit)
 * are never retried — see scripts/run-l2.ts for the original contract.
 */

export type RunnerOutcome =
	| { kind: "success" }
	| { kind: "setup-failure"; reason: string }
	| { kind: "worker-failure"; reason: string }
	| { kind: "test-failure"; exitCode: number };

/**
 * Parse `L2_ATTEMPTS` / `L3_ATTEMPTS` style env vars.
 * Invalid values fall back to `fallback` (default 3) with a warning.
 */
export function parseAttempts(envName: string, fallback = 3): number {
	const raw = process.env[envName];
	if (!raw) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) {
		console.warn(`⚠️  ${envName}="${raw}" is not a positive integer, falling back to ${fallback}`);
		return fallback;
	}
	return n;
}

/**
 * After a non-zero test exit, classify whether the worker is still healthy.
 * Dead/unresponsive worker → worker-failure (retryable). Alive → test-failure.
 */
export async function classifyTestExit(args: {
	exitCode: number;
	hasExited: () => boolean;
	exitCodeOfWorker: () => number | null;
	isAlive: () => Promise<boolean>;
}): Promise<RunnerOutcome> {
	if (args.exitCode === 0) return { kind: "success" };

	if (args.hasExited()) {
		return {
			kind: "worker-failure",
			reason: `worker died during tests (exit code ${args.exitCodeOfWorker()})`,
		};
	}
	if (!(await args.isAlive())) {
		return {
			kind: "worker-failure",
			reason: "worker stopped responding to /api/live mid-run",
		};
	}
	return { kind: "test-failure", exitCode: args.exitCode };
}

/**
 * Drive `runOnce` up to `totalAttempts` times. Only `worker-failure`
 * outcomes retry; setup/test failures exit immediately.
 *
 * `cleanup` runs after every attempt (success or failure).
 */
export async function runWithRetries(args: {
	label: string;
	totalAttempts: number;
	runOnce: (attempt: number, totalAttempts: number) => Promise<RunnerOutcome>;
	cleanup: () => Promise<void> | void;
	retryDelayMs?: number;
}): Promise<number> {
	const { label, totalAttempts, runOnce, cleanup, retryDelayMs = 1000 } = args;
	let exitCode = 1;
	let lastFailure = `${label} runner failed`;

	for (let attempt = 1; attempt <= totalAttempts; attempt++) {
		let outcome: RunnerOutcome;
		try {
			outcome = await runOnce(attempt, totalAttempts);
		} catch (err) {
			outcome = {
				kind: "worker-failure",
				reason: err instanceof Error ? err.message : String(err),
			};
		} finally {
			await cleanup();
		}

		if (outcome.kind === "success") {
			exitCode = 0;
			break;
		}
		if (outcome.kind === "setup-failure") {
			console.error(`❌ Setup failed — not retrying: ${outcome.reason}`);
			exitCode = 1;
			lastFailure = `setup failure: ${outcome.reason}`;
			break;
		}
		if (outcome.kind === "test-failure") {
			console.error(
				`❌ Tests failed (exit ${outcome.exitCode}) with worker still alive — not retrying`,
			);
			exitCode = outcome.exitCode;
			lastFailure = `tests exited with code ${outcome.exitCode}`;
			break;
		}
		console.warn(
			`⚠️  ${label} attempt ${attempt}/${totalAttempts} worker failure: ${outcome.reason}`,
		);
		lastFailure = outcome.reason;
		exitCode = 1;
		if (attempt < totalAttempts) {
			await new Promise((r) => setTimeout(r, retryDelayMs));
		}
	}

	if (exitCode !== 0) {
		console.error(`❌ ${label} runner failed after ${totalAttempts} attempt(s): ${lastFailure}`);
	}
	return exitCode;
}
