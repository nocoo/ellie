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
 *   bun run scripts/backfill-avatar-flag.ts
 *
 * Note: This script must be run as a Cloudflare Worker script using wrangler,
 * or manually via the Cloudflare dashboard. The script below generates SQL
 * that can be executed via the D1 console.
 *
 * Alternative approach (recommended):
 *   1. Export R2 object list via Cloudflare dashboard
 *   2. Run this script locally to generate SQL
 *   3. Execute SQL via D1 console or wrangler d1 execute
 */

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

console.log("🔄 Avatar Flag Backfill Script\n");
console.log(`   Mode: ${isDryRun ? "DRY RUN" : "GENERATE SQL"}`);
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

/**
 * Generate SQL UPDATE statements for a batch of UIDs.
 * Uses batched IN clauses to minimize statement count.
 */
function generateUpdateSql(uids: number[], batchSize = 100): string[] {
	const statements: string[] = [];

	for (let i = 0; i < uids.length; i += batchSize) {
		const batch = uids.slice(i, i + batchSize);
		const placeholders = batch.join(", ");
		statements.push(
			`UPDATE users SET has_avatar = 1 WHERE id IN (${placeholders}) AND has_avatar = 0;`,
		);
	}

	return statements;
}

async function main() {
	// Check if we have an input file with R2 keys
	const inputFile = args.find((a) => a.endsWith(".txt") || a.endsWith(".json"));

	if (!inputFile) {
		console.log("📋 No input file provided. To use this script:");
		console.log("");
		console.log("   1. Export R2 object list from Cloudflare Dashboard:");
		console.log("      - Go to R2 > tongjinet bucket");
		console.log("      - List objects with prefix 'avatar/'");
		console.log("      - Export to a text file (one key per line)");
		console.log("");
		console.log("   2. Run this script with the file:");
		console.log("      bun run scripts/backfill-avatar-flag.ts avatar-keys.txt");
		console.log("");
		console.log("   3. Or use wrangler directly in a Worker:");
		console.log("      - The R2 list API must be called from within a Worker");
		console.log("      - See docs for R2 bucket.list() API usage");
		console.log("");

		// Generate example output
		console.log("📝 Example: For UIDs 1, 12345, 999999:");
		const exampleUids = [1, 12345, 999999];
		const exampleSql = generateUpdateSql(exampleUids);
		console.log("");
		for (const sql of exampleSql) {
			console.log(`   ${sql}`);
		}
		console.log("");
		console.log(
			"   Run via: npx wrangler d1 execute tongjinet-db --remote -c apps/worker/wrangler.toml --command '<SQL>'",
		);

		return;
	}

	// Read input file
	console.log(`📂 Reading avatar keys from: ${inputFile}`);
	const content = await Bun.file(inputFile).text();

	let keys: string[];
	if (inputFile.endsWith(".json")) {
		// JSON format: array of { key: string } objects
		const data = JSON.parse(content) as { key: string }[] | string[];
		keys = data.map((item) => (typeof item === "string" ? item : item.key));
	} else {
		// Text format: one key per line
		keys = content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	// Filter to avatar keys and extract UIDs
	const avatarKeys = keys.filter((key) => key.endsWith("_avatar_big.jpg"));
	console.log(`   Found ${avatarKeys.length} avatar files\n`);

	const uids: number[] = [];
	for (const key of avatarKeys) {
		const uid = extractUidFromKey(key);
		if (uid !== null && uid > 0) {
			uids.push(uid);
		}
	}

	console.log(`🔢 Extracted ${uids.length} valid UIDs\n`);

	if (uids.length === 0) {
		console.log("✅ No users to update");
		return;
	}

	// Generate SQL
	const statements = generateUpdateSql(uids);

	if (isDryRun) {
		console.log("📝 Generated SQL (dry run):\n");
		for (const sql of statements) {
			console.log(sql);
		}
		console.log(`\n   Total: ${statements.length} statements for ${uids.length} users`);
	} else {
		// Write to output file
		const outputFile = "backfill-avatar-flag.sql";
		await Bun.write(outputFile, statements.join("\n"));
		console.log(`✅ Generated SQL written to: ${outputFile}`);
		console.log(`   Total: ${statements.length} statements for ${uids.length} users`);
		console.log("");
		console.log("   To execute:");
		console.log(
			`   cat ${outputFile} | npx wrangler d1 execute tongjinet-db --remote -c apps/worker/wrangler.toml --file=${outputFile}`,
		);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
