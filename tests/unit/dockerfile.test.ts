import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

describe("Docker build runtimes", () => {
	test("pins production Bun to 1.4.4 across deps, builder, and runner", () => {
		expect(dockerfile).toContain(
			"ARG BUN_STABLE_IMAGE=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d",
		);
		expect(dockerfile).not.toContain("BUN_BUILD_IMAGE");
		expect(dockerfile).not.toContain("build-runtime");
		expect(dockerfile.match(/FROM \$\{BUN_STABLE_IMAGE\}/g)).toHaveLength(3);

		const stableInstall = dockerfile.lastIndexOf("RUN bun install --frozen-lockfile");
		const appBuild = dockerfile.indexOf("bun run build:admin");

		expect(stableInstall).toBeGreaterThan(-1);
		expect(appBuild).toBeGreaterThan(stableInstall);
	});
});
