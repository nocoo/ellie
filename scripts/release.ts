#!/usr/bin/env bun
/**
 * Release script for Ellie monorepo
 *
 * Usage:
 *   bun run release              # Z+1 patch (default)
 *   bun run release -- minor     # Y+1 minor
 *   bun run release -- major     # X+1 major
 *   bun run release -- 2.0.0     # specific version
 *   bun run release -- --dry-run # preview only
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// All package.json files to update
const PACKAGE_FILES = [
	"package.json",
	"apps/worker/package.json",
	"apps/web/package.json",
	"apps/admin/package.json",
	"packages/types/package.json",
	"packages/repositories/package.json",
	"packages/ui/package.json",
	"packages/cli/package.json",
	"packages/shared/package.json",
	"packages/migrate/package.json",
	"packages/db/package.json",
];

// Version source files
const VERSION_TS = "packages/types/src/version.ts";
const VERSION_DTS = "packages/types/src/version.d.ts";

function getCurrentVersion(): string {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
	return pkg.version;
}

function parseVersion(v: string): [number, number, number] {
	const parts = v.split(".").map(Number);
	if (parts.length !== 3 || parts.some(Number.isNaN)) {
		throw new Error(`Invalid version format: ${v}`);
	}
	return parts as [number, number, number];
}

function bumpVersion(current: string, type: "major" | "minor" | "patch"): string {
	const [x, y, z] = parseVersion(current);
	switch (type) {
		case "major":
			return `${x + 1}.0.0`;
		case "minor":
			return `${x}.${y + 1}.0`;
		case "patch":
			return `${x}.${y}.${z + 1}`;
	}
}

function updatePackageJson(file: string, newVersion: string, dryRun: boolean) {
	const path = join(ROOT, file);
	const content = readFileSync(path, "utf-8");
	const updated = content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
	if (!dryRun) {
		writeFileSync(path, updated);
	}
	console.log(`  ${dryRun ? "[dry-run] " : ""}${file}`);
}

function updateVersionTs(newVersion: string, dryRun: boolean) {
	const path = join(ROOT, VERSION_TS);
	const content = `// Version constant — single source of truth from root package.json
// Display format: "v${newVersion}" (with "v" prefix for frontend/docs)

export const VERSION = "${newVersion}";
export const VERSION_DISPLAY = \`v\${VERSION}\`;
`;
	if (!dryRun) {
		writeFileSync(path, content);
	}
	console.log(`  ${dryRun ? "[dry-run] " : ""}${VERSION_TS}`);
}

function updateVersionDts(newVersion: string, dryRun: boolean) {
	const path = join(ROOT, VERSION_DTS);
	const content = `export declare const VERSION = "${newVersion}";
export declare const VERSION_DISPLAY = "v${newVersion}";
`;
	if (!dryRun) {
		writeFileSync(path, content);
	}
	console.log(`  ${dryRun ? "[dry-run] " : ""}${VERSION_DTS}`);
}

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const versionArg = args.find((a) => !a.startsWith("-"));

	const current = getCurrentVersion();
	let newVersion: string;

	if (!versionArg || versionArg === "patch") {
		newVersion = bumpVersion(current, "patch");
	} else if (versionArg === "minor") {
		newVersion = bumpVersion(current, "minor");
	} else if (versionArg === "major") {
		newVersion = bumpVersion(current, "major");
	} else if (/^\d+\.\d+\.\d+$/.test(versionArg)) {
		newVersion = versionArg;
	} else {
		console.error(`Invalid version argument: ${versionArg}`);
		console.error("Usage: bun run release [patch|minor|major|X.Y.Z] [--dry-run]");
		process.exit(1);
	}

	console.log(`\n📦 Ellie Release${dryRun ? " (dry-run)" : ""}`);
	console.log(`   ${current} → ${newVersion}\n`);

	console.log("Updating package.json files:");
	for (const file of PACKAGE_FILES) {
		updatePackageJson(file, newVersion, dryRun);
	}

	console.log("\nUpdating version source files:");
	updateVersionTs(newVersion, dryRun);
	updateVersionDts(newVersion, dryRun);

	if (!dryRun) {
		console.log("\nRunning bun install to sync lockfile...");
		await $`bun install`.cwd(ROOT);

		console.log(`\n✅ Version updated to ${newVersion}`);
		console.log("\nNext steps:");
		console.log("  1. Review changes and update CHANGELOG.md");
		console.log("  2. git add -A && git commit -m 'chore: release v" + newVersion + "'");
		console.log("  3. git tag v" + newVersion);
		console.log("  4. git push && git push --tags");
		console.log("  5. bun run worker:deploy (if Worker changed)");
	} else {
		console.log(`\n✅ Dry run complete — no files modified`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
