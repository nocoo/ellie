import { DEFAULT_CONFIG, type MigrateConfig, parseCliArgs } from "./cli";
import {
	type AttachmentIndexData,
	type MemberCountData,
	type MemberData,
	extractAttachment,
	extractForum,
	extractPost,
	extractThread,
	extractUser,
	parseAttachmentIndex,
	parseMemberCountRow,
	parseMemberRow,
} from "./extract/extractors";
import { parseDumpFile } from "./extract/parser";
import { BatchLoader } from "./load/batch-insert";

export type { MigrateConfig };
export { parseCliArgs };

// ─── Logging ────────────────────────────────────────────────────────────────

export interface MigrateStats {
	forums: number;
	users: number;
	threads: number;
	posts: number;
	attachments: number;
	skipped: { [key: string]: number };
	errors: string[];
	duration: number;
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

// ─── Step 1: Forums ─────────────────────────────────────────────────────────

/**
 * Migrate forums: parse pre_forum_forum + pre_forum_forumfield from main_small dump.
 */
export async function migrateForums(loader: BatchLoader, sourceDir: string): Promise<number> {
	log("=== Forums ===");
	const dumpFile = `${sourceDir}/main_small.sql.gz`;

	// First pass: collect forumfield data (description + icon)
	log("  Parsing pre_forum_forumfield...");
	const forumFields = new Map<number, { description: string; icon: string }>();
	await parseDumpFile(dumpFile, "pre_forum_forumfield", (row) => {
		// forumfield columns: fid=0, description=1, ..., icon=5 (approximate)
		// We need fid, description, icon — positions depend on actual dump
		const fid = Number(row[0]);
		const description = row[1] ?? "";
		const icon = row[5] ?? "";
		forumFields.set(fid, { description, icon });
	});
	log(`  Collected ${forumFields.size} forum field records`);

	// Second pass: extract forum rows
	log("  Parsing pre_forum_forum...");
	const inserter = loader.createStreamInserter("forums");
	await parseDumpFile(dumpFile, "pre_forum_forum", (row) => {
		const record = extractForum(row, forumFields);
		if (record) inserter.add(record);
	});
	const total = inserter.flush();
	log(`  Forums: ${total} rows inserted`);
	return total;
}

// ─── Step 2: Users ──────────────────────────────────────────────────────────

/**
 * Migrate users: join uc_members + pre_common_member + pre_common_member_archive + count data.
 *
 * Strategy per docs/03-migration.md:
 * 1. Parse pre_common_member → memberMap (uid → MemberData)
 * 2. Parse pre_common_member_archive → archiveMap (uid → MemberData)
 * 3. Parse pre_common_member_count → countMap (uid → MemberCountData)
 * 4. Stream uc_members: for each uid, look up member/archive/count data
 */
export async function migrateUsers(loader: BatchLoader, sourceDir: string): Promise<number> {
	log("=== Users ===");
	const mainDump = `${sourceDir}/main_small.sql.gz`;
	const ucDump = `${sourceDir}/ucenter.sql.gz`;

	// Step 1: Collect pre_common_member data
	log("  Parsing pre_common_member...");
	const memberMap = new Map<number, MemberData>();
	await parseDumpFile(mainDump, "pre_common_member", (row) => {
		const { uid, data } = parseMemberRow(row);
		memberMap.set(uid, data);
	});
	log(`  Collected ${memberMap.size} active member records`);

	// Step 2: Collect pre_common_member_archive data (optional — may not be in dump)
	log("  Parsing pre_common_member_archive...");
	const archiveMap = new Map<number, MemberData>();
	try {
		await parseDumpFile(mainDump, "pre_common_member_archive", (row) => {
			const { uid, data } = parseMemberRow(row);
			archiveMap.set(uid, data);
		});
	} catch {
		// Table may not exist in the dump — that's OK
	}
	log(`  Collected ${archiveMap.size} archived member records`);

	// Step 3: Collect pre_common_member_count data (optional)
	log("  Parsing pre_common_member_count...");
	const countMap = new Map<number, MemberCountData>();
	try {
		await parseDumpFile(mainDump, "pre_common_member_count", (row) => {
			const { uid, data } = parseMemberCountRow(row);
			countMap.set(uid, data);
		});
	} catch {
		// Table may not exist in the dump — that's OK
	}
	log(`  Collected ${countMap.size} member count records`);

	// Step 4: Stream uc_members and build user rows
	log("  Parsing uc_members...");
	const inserter = loader.createStreamInserter("users");
	await parseDumpFile(ucDump, "uc_members", (row) => {
		const uid = Number(row[0]);
		const member = memberMap.get(uid) ?? archiveMap.get(uid) ?? null;
		const isArchived = !memberMap.has(uid) && archiveMap.has(uid);
		const counts = countMap.get(uid) ?? null;
		const record = extractUser(row, member, counts, isArchived);
		inserter.add(record);
	});
	const total = inserter.flush();
	log(`  Users: ${total} rows inserted`);
	return total;
}

// ─── Step 3: Threads ────────────────────────────────────────────────────────

/**
 * Migrate threads from thread.sql.gz.
 */
export async function migrateThreads(
	loader: BatchLoader,
	sourceDir: string,
): Promise<{ total: number; skipped: number }> {
	log("=== Threads ===");
	const dumpFile = `${sourceDir}/thread.sql.gz`;
	const inserter = loader.createStreamInserter("threads");
	let skipped = 0;

	await parseDumpFile(dumpFile, "pre_forum_thread", (row) => {
		const record = extractThread(row);
		if (record) {
			inserter.add(record);
		} else {
			skipped++;
		}
	});
	const total = inserter.flush();
	log(`  Threads: ${total} inserted, ${skipped} skipped (hidden/merged)`);
	return { total, skipped };
}

// ─── Step 4: Posts ──────────────────────────────────────────────────────────

/**
 * Migrate posts from post_main.sql.gz (pre_forum_post) and
 * post_shards.sql.gz (pre_forum_post_1 ~ pre_forum_post_4).
 *
 * This is the largest table (~9.4M rows), uses streaming insert.
 */
export async function migratePosts(
	loader: BatchLoader,
	sourceDir: string,
): Promise<{ total: number; filtered: number; encodingRepaired: number; bbcodeFailures: number }> {
	log("=== Posts ===");
	const stats = { total: 0, filtered: 0, encodingRepaired: 0, bbcodeFailures: 0 };
	const inserter = loader.createStreamInserter("posts");

	// Main table: pre_forum_post
	const mainDump = `${sourceDir}/post_main.sql.gz`;
	log("  Parsing pre_forum_post (main)...");
	await parseDumpFile(mainDump, "pre_forum_post", (row) => {
		const record = extractPost(row, stats);
		if (record) inserter.add(record);
	});

	// Shard tables: pre_forum_post_1 ~ pre_forum_post_4
	const shardDump = `${sourceDir}/post_shards.sql.gz`;
	for (let i = 1; i <= 4; i++) {
		const tableName = `pre_forum_post_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(shardDump, tableName, (row) => {
			const record = extractPost(row, stats);
			if (record) inserter.add(record);
		});
	}

	const total = inserter.flush();
	// Sync stats.total with actual inserted count (in case of discrepancy)
	stats.total = total;
	log(
		`  Posts: ${total} inserted, ${stats.filtered} filtered, ${stats.encodingRepaired} encoding repairs, ${stats.bbcodeFailures} BBCode failures`,
	);
	return stats;
}

// ─── Step 5: Attachments ────────────────────────────────────────────────────

/**
 * Migrate attachments: index table + 10 shard tables from main_small.sql.gz.
 */
export async function migrateAttachments(
	loader: BatchLoader,
	sourceDir: string,
): Promise<{ total: number; skipped: number }> {
	log("=== Attachments ===");
	const dumpFile = `${sourceDir}/main_small.sql.gz`;

	// First pass: collect attachment index data
	log("  Parsing pre_forum_attachment (index)...");
	const indexMap = new Map<number, AttachmentIndexData>();
	await parseDumpFile(dumpFile, "pre_forum_attachment", (row) => {
		const idx = parseAttachmentIndex(row);
		indexMap.set(idx.aid, idx);
	});
	log(`  Collected ${indexMap.size} attachment index records`);

	// Second pass: parse shard tables _0 ~ _9
	const inserter = loader.createStreamInserter("attachments");
	let skipped = 0;

	for (let i = 0; i <= 9; i++) {
		const tableName = `pre_forum_attachment_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(dumpFile, tableName, (row) => {
			const record = extractAttachment(row, indexMap);
			if (record) {
				inserter.add(record);
			} else {
				skipped++;
			}
		});
	}

	const total = inserter.flush();
	log(`  Attachments: ${total} inserted, ${skipped} skipped (no index match)`);
	return { total, skipped };
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

/**
 * Run the full migration pipeline.
 */
export async function runMigration(config: MigrateConfig): Promise<MigrateStats> {
	const startTime = Date.now();
	const stats: MigrateStats = {
		forums: 0,
		users: 0,
		threads: 0,
		posts: 0,
		attachments: 0,
		skipped: {},
		errors: [],
		duration: 0,
	};

	log("Migration starting");
	log(`  Source: ${config.sourceDir}`);
	log(`  Output: ${config.dbPath}`);
	log(`  Batch size: ${config.batchSize}`);

	const loader = new BatchLoader({
		dbPath: config.dbPath,
		batchSize: config.batchSize,
		progressInterval: config.progressInterval,
		onProgress: (table, count) => {
			log(`  [${table}] ${count.toLocaleString()} rows...`);
		},
	});

	try {
		// Create tables (no indexes yet — per docs/03-migration.md)
		log("Creating tables...");
		loader.createTables();

		// Migrate in FK dependency order
		stats.forums = await migrateForums(loader, config.sourceDir);

		stats.users = await migrateUsers(loader, config.sourceDir);

		const threadResult = await migrateThreads(loader, config.sourceDir);
		stats.threads = threadResult.total;
		stats.skipped.threads = threadResult.skipped;

		const postResult = await migratePosts(loader, config.sourceDir);
		stats.posts = postResult.total;
		stats.skipped.posts = postResult.filtered;

		const attachResult = await migrateAttachments(loader, config.sourceDir);
		stats.attachments = attachResult.total;
		stats.skipped.attachments = attachResult.skipped;

		// Create indexes after all data is loaded (much faster)
		log("Creating indexes...");
		loader.createIndexes();
		log("Indexes created");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stats.errors.push(msg);
		log(`ERROR: ${msg}`);
	} finally {
		loader.close();
	}

	stats.duration = Date.now() - startTime;
	log(`Migration complete in ${(stats.duration / 1000).toFixed(1)}s`);
	log(`  Forums:      ${stats.forums.toLocaleString()}`);
	log(`  Users:       ${stats.users.toLocaleString()}`);
	log(`  Threads:     ${stats.threads.toLocaleString()}`);
	log(`  Posts:       ${stats.posts.toLocaleString()}`);
	log(`  Attachments: ${stats.attachments.toLocaleString()}`);

	return stats;
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

// Only run when executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
	const overrides = parseCliArgs(process.argv.slice(2));
	const config: MigrateConfig = { ...DEFAULT_CONFIG, ...overrides };

	// Ensure output directory exists
	const { mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	mkdirSync(dirname(config.dbPath), { recursive: true });

	const stats = await runMigration(config);
	if (stats.errors.length > 0) {
		process.exit(1);
	}
}
