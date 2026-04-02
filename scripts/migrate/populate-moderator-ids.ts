#!/usr/bin/env bun
/**
 * Populate moderator_ids column from moderators (usernames) column.
 *
 * Usage:
 *   bun scripts/migrate/populate-moderator-ids.ts
 *
 * This script:
 * 1. Reads all forums with moderators set
 * 2. Parses usernames (tab or comma separated)
 * 3. Looks up user IDs by username
 * 4. Updates moderator_ids column
 *
 * Must be run with wrangler d1 execute or against a local D1 database.
 */

import { $ } from "bun";

const WRANGLER_CONFIG = "apps/worker/wrangler.toml";
const DATABASE_NAME = "tongjinet-db";

interface Forum {
	id: number;
	moderators: string;
	moderator_ids: string;
}

interface User {
	id: number;
	username: string;
}

async function execD1(sql: string): Promise<string> {
	const result = await $`npx wrangler d1 execute ${DATABASE_NAME} -c ${WRANGLER_CONFIG} --remote --json --command ${sql}`.text();
	return result;
}

async function main() {
	console.log("🔍 Fetching forums with moderators...");

	// Get all forums with moderators set
	const forumsResult = await execD1("SELECT id, moderators, moderator_ids FROM forums WHERE moderators != ''");
	const forumsData = JSON.parse(forumsResult);
	const forums: Forum[] = forumsData[0]?.results ?? [];

	console.log(`📋 Found ${forums.length} forums with moderators`);

	if (forums.length === 0) {
		console.log("✅ No forums need updating");
		return;
	}

	// Get all users for username lookup
	console.log("🔍 Fetching user lookup table...");
	const usersResult = await execD1("SELECT id, username FROM users");
	const usersData = JSON.parse(usersResult);
	const users: User[] = usersData[0]?.results ?? [];

	const usernameToId = new Map<string, number>();
	for (const user of users) {
		usernameToId.set(user.username.toLowerCase(), user.id);
	}
	console.log(`📋 Loaded ${usernameToId.size} usernames`);

	// Process each forum
	let updated = 0;
	let skipped = 0;

	for (const forum of forums) {
		// Parse moderator usernames (could be tab or comma separated)
		const usernames = forum.moderators
			.split(/[\t,]/)
			.map(s => s.trim())
			.filter(Boolean);

		if (usernames.length === 0) {
			skipped++;
			continue;
		}

		// Look up user IDs
		const ids: number[] = [];
		for (const username of usernames) {
			const id = usernameToId.get(username.toLowerCase());
			if (id) {
				ids.push(id);
			} else {
				console.warn(`⚠️ Forum ${forum.id}: moderator "${username}" not found`);
			}
		}

		if (ids.length === 0) {
			console.warn(`⚠️ Forum ${forum.id}: no valid moderator IDs found for "${forum.moderators}"`);
			skipped++;
			continue;
		}

		const moderatorIds = ids.join(",");

		// Skip if already set correctly
		if (forum.moderator_ids === moderatorIds) {
			console.log(`⏭️ Forum ${forum.id}: already up to date`);
			continue;
		}

		// Update the forum
		console.log(`📝 Forum ${forum.id}: "${forum.moderators}" -> [${moderatorIds}]`);
		await execD1(`UPDATE forums SET moderator_ids = '${moderatorIds}' WHERE id = ${forum.id}`);
		updated++;
	}

	console.log("");
	console.log("✅ Migration complete!");
	console.log(`   Updated: ${updated}`);
	console.log(`   Skipped: ${skipped}`);
}

main().catch(console.error);
