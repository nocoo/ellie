/**
 * scripts/lib/local-d1 — shared local D1 lifecycle (cleanup → migrate → seed).
 *
 * Used by run-l2.ts / run-l3.ts / run-l3-admin.ts so all three lifecycles
 * share the same migration apply + seed flow against an isolated
 * --persist-to dir. Each lifecycle picks its own dir so multiple test
 * environments can run concurrently without stomping each other.
 *
 * `initLocalD1` does:
 *   1. rm -rf <persistTo>           (fresh state every run)
 *   2. wrangler d1 migrations apply DB --local --persist-to <persistTo>
 *   3. wrangler d1 execute DB --local --persist-to <persistTo> --file <seedFile>
 *
 * Steps 2 / 3 reuse the project's wrangler.toml main [[d1_databases]]
 * binding — the `--local` flag isolates everything to the persist dir,
 * so reusing the production DB *name* is safe.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type Subprocess, spawn } from "bun";

export interface LocalD1Options {
	/** Path (relative to repoRoot) of the wrangler --persist-to dir. */
	persistTo: string;
	/** Repo root. Absolute. */
	repoRoot: string;
	/** Path to wrangler binary. Absolute. */
	wranglerBin: string;
	/** Path (relative to repoRoot) of the wrangler config. */
	wranglerConfig: string;
	/** Optional seed file (relative to repoRoot). Skipped if absent. */
	seedFile?: string;
	/** Per-step timeout (ms). Default 60s. */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function abs(repoRoot: string, p: string): string {
	return resolve(repoRoot, p);
}

async function runWranglerOnce(
	bin: string,
	args: string[],
	cwd: string,
	label: string,
	timeoutMs: number,
): Promise<void> {
	console.log(`▶ ${label}`);
	const proc = spawn({
		cmd: [bin, ...args],
		cwd,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`${label} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	try {
		const code = await Promise.race([proc.exited, timeout]);
		if (typeof code === "number" && code !== 0) {
			throw new Error(`${label} exited with code ${code}`);
		}
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function cleanupPersistDir(opts: Pick<LocalD1Options, "persistTo" | "repoRoot">): void {
	const persistAbs = abs(opts.repoRoot, opts.persistTo);
	console.log("🧹 Cleaning local D1 state…");
	if (existsSync(persistAbs)) {
		rmSync(persistAbs, { recursive: true, force: true });
		console.log(`   removed ${opts.persistTo}`);
	} else {
		console.log("   no previous state");
	}
}

export async function migrateLocalD1(opts: LocalD1Options): Promise<void> {
	await runWranglerOnce(
		opts.wranglerBin,
		[
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--persist-to",
			opts.persistTo,
			"-c",
			opts.wranglerConfig,
		],
		opts.repoRoot,
		"Applying D1 migrations (local)",
		opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
}

export async function seedLocalD1(opts: LocalD1Options): Promise<void> {
	if (!opts.seedFile) return;
	if (!existsSync(abs(opts.repoRoot, opts.seedFile))) {
		console.log(`⚠️  Seed file ${opts.seedFile} not found, skipping seed step`);
		return;
	}
	await runWranglerOnce(
		opts.wranglerBin,
		[
			"d1",
			"execute",
			"DB",
			"--local",
			"--persist-to",
			opts.persistTo,
			"-c",
			opts.wranglerConfig,
			"--file",
			opts.seedFile,
		],
		opts.repoRoot,
		"Seeding test data",
		opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
}

/** cleanup + migrate + seed. */
export async function initLocalD1(opts: LocalD1Options): Promise<void> {
	cleanupPersistDir(opts);
	await migrateLocalD1(opts);
	await seedLocalD1(opts);
}

/** Re-export Subprocess type for callers that own worker lifecycles. */
export type { Subprocess };
