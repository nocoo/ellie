import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@ellie/types";
import { describe, expect, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runBun(args: string[]) {
	return spawnSync("bun", args, {
		cwd: ROOT,
		encoding: "utf8",
		env: { ...process.env },
	});
}

describe("legacy TypeScript CLI version contract", () => {
	test("direct and root CLI use the shared version for --version", () => {
		const direct = runBun(["packages/cli/src/index.ts", "--version"]);
		expect(direct.status).toBe(0);
		expect(direct.stderr).toBe("");
		expect(direct.stdout.trim()).toBe(VERSION);
		expect(direct.stdout).not.toContain("0.1.0");

		const root = runBun(["run", "cli", "--", "--version"]);
		expect(root.status).toBe(0);
		expect(root.stdout).toContain(VERSION);
		expect(root.stdout).not.toContain("0.1.0");
	});

	test("direct and root CLI retain normal --help behavior", () => {
		const direct = runBun(["packages/cli/src/index.ts", "--help"]);
		expect(direct.status).toBe(0);
		expect(direct.stdout).toContain("Usage: ellie [options]");
		expect(direct.stdout).toContain("-V, --version");
		expect(direct.stdout).toContain("-h, --help");

		const root = runBun(["run", "cli", "--", "--help"]);
		expect(root.status).toBe(0);
		expect(root.stdout).toContain("Usage: ellie [options]");
		expect(root.stdout).toContain("-V, --version");
		expect(root.stdout).toContain("-h, --help");
	});

	test("root cli script targets the named workspace", () => {
		const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
		expect(manifest.scripts.cli).toBe("bun run --filter '@ellie/cli' start");
	});
});
