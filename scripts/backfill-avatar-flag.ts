#!/usr/bin/env bun
/**
 * backfill-avatar-flag.ts — Backfill has_avatar flag from R2
 *
 * Scans R2 bucket for existing avatar files and sets has_avatar = 1
 * for corresponding users. Run once after migration to sync existing data.
 *
 * Prerequisites:
 * 1. Run migration 0026_add_has_avatar.sql first
 * 2. Ensure R2 bucket is configured in wrangler.toml
 *
 * Usage:
 *   # Dry run (check what would be updated)
 *   bun run scripts/backfill-avatar-flag.ts --dry-run
 *
 *   # Production (actually update database)
 *   bun run scripts/backfill-avatar-flag.ts --env production
 *
 * Notes:
 * - Uses wrangler d1 and r2 CLI commands
 * - Processes in batches to avoid timeout
 * - Safe to run multiple times (idempotent)
 */

import { $ } from "bun";

const R2_BUCKET = "tongjinet";
const WRANGLER_CONFIG = "apps/worker/wrangler.toml";
const BATCH_SIZE = 100;

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const env = args.find((a) => a.startsWith("--env="))?.split("=")[1] || "production";

console.log("🔄 Avatar Flag Backfill Script\n");
console.log(`   Mode: ${isDryRun ? "DRY RUN" : "PRODUCTION"}`);
console.log(`   Environment: ${env}`);
console.log(`   R2 Bucket: ${R2_BUCKET}`);
console.log("");

/**
 * Extract UID from R2 avatar key path.
 * Path format: avatar/000/01/23/45_avatar_big.jpg
 * UID: 000012345 -> 12345
 */
function extractUidFromKey(key: string): number | null {
	const match = key.match(/^avatar\/(\d{3})\/(\d{2})\/(\d{2})\/(\d{2})_avatar_big\.jpg$/);
	if (!match) return null;

	const paddedUid = match[1] + match[2] + match[3] + match[4];
	return Number.parseInt(paddedUid, 10);
}

async function listAvatarKeys(): Promise<string[]> {
	console.log("📂 Listing R2 objects with prefix 'avatar/'...");

	try {
		// Use wrangler r2 object list to get all avatar files
		const result = await $`npx wrangler r2 object list ${R2_BUCKET} --prefix avatar/ -c ${WRANGLER_CONFIG}`.text();

		// Parse JSON output
		const objects = JSON.parse(result) as { key: string }[];
		const avatarKeys = objects
			.map((obj) => obj.key)
			.filter((key) => key.endsWith("_avatar_big.jpg"));

		console.log(`   Found ${avatarKeys.length} avatar files\n`);
		return avatarKeys;
	} catch (error) {
		console.error("❌ Failed to list R2 objects:", error);
		process.exit(1);
	}
}

async function updateUserFlags(uids: number[]): Promise<void> {
	if (uids.length === 0) {
		console.log("✅ No users to update");
		return;
	}

	console.log(`📝 Updating has_avatar flag for ${uids.length} users...`);

	if (isDryRun) {
		console.log("   (Dry run - no changes made)");
		console.log(`   Would update UIDs: ${uids.slice(0, 10).join(", ")}${uids.length > 10 ? "..." : ""}`);
		return;
	}

	// Process in batches
	for (let i = 0; i < uids.length; i += BATCH_SIZE) {
		const batch = uids.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");
		const sql = `UPDATE users SET has_avatar = 1 WHERE id IN (${placeholders}) AND has_avatar = 0`;

		try {
			// Use wrangler d1 execute
			const envFlag = env === "production" ? "--remote" : `--env ${env}`;
			await $`npx wrangler d1 execute tongjinet-db ${envFlag} -c ${WRANGLER_CONFIG} --command ${sql} -- ${batch.join(" ")}`.quiet();

			console.log(`   ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uids.length / BATCH_SIZE)}`);
		} catch (error) {
			console.error(`   ❌ Failed to update batch:`, error);
		}
	}

	console.log("✅ Backfill complete\n");
}

async function main() {
	// Step 1: List all avatar files in R2
	const avatarKeys = await listAvatarKeys();

	// Step 2: Extract UIDs from paths
	const uids: number[] = [];
	for (const key of avatarKeys) {
		const uid = extractUidFromKey(key);
		if (uid !== null && uid > 0) {
			uids.push(uid);
		}
	}

	console.log(`🔢 Extracted ${uids.length} valid UIDs from avatar paths\n`);

	// Step 3: Update database
	await updateUserFlags(uids);

	// Summary
	console.log("📊 Summary:");
	console.log(`   Total avatar files: ${avatarKeys.length}`);
	console.log(`   Valid UIDs: ${uids.length}`);
	console.log(`   Mode: ${isDryRun ? "DRY RUN (no changes)" : "PRODUCTION (updated)"}`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
