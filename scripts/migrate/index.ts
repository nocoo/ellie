/**
 * Migration orchestrator — coordinates the full ETL pipeline.
 *
 * Reads MySQL dump files from reference/db/, extracts rows, transforms data,
 * and loads into a local SQLite database (D1-compatible format).
 *
 * Usage:
 *   bun run scripts/migrate/index.ts [--db output.db] [--source reference/db]
 *
 * Per docs/03-migration.md: migrate in FK dependency order:
 *   forums → users → threads → posts → attachments
 */

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
import { type ParsedRow, parseDumpFile } from "./extract/parser";
import { BatchLoader } from "./load/batch-insert";
import { MigrationLogger } from "./load/logger";
import { verifyEncoding } from "./verify/encoding";
import { type ExpectedCounts, verifyIntegrity } from "./verify/integrity";
import { verifyPerformance } from "./verify/performance";

export type { MigrateConfig };
export { parseCliArgs };

// ─── Stats ──────────────────────────────────────────────────────────────────

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

export async function migrateForums(loader: BatchLoader, sourceDir: string): Promise<number> {
	log("=== Forums ===");
	const dumpFile = `${sourceDir}/main_small.sql.gz`;

	log("  Parsing pre_forum_forumfield...");
	const forumFields = new Map<number, { description: string; icon: string }>();
	await parseDumpFile(dumpFile, "pre_forum_forumfield", (row) => {
		// forumfield columns verified from DDL: fid=0, description=1, password=2, icon=3
		const fid = Number(row[0]);
		const description = row[1] ?? "";
		const icon = row[3] ?? "";
		forumFields.set(fid, { description, icon });
	});
	log(`  Collected ${forumFields.size} forum field records`);

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

export async function migrateUsers(
	loader: BatchLoader,
	sourceDir: string,
): Promise<{ total: number; userIds: Set<number> }> {
	log("=== Users ===");
	const mainDump = `${sourceDir}/main_small.sql.gz`;
	const ucDump = `${sourceDir}/ucenter.sql.gz`;

	log("  Parsing pre_common_member...");
	const memberMap = new Map<number, MemberData>();
	await parseDumpFile(mainDump, "pre_common_member", (row) => {
		const { uid, data } = parseMemberRow(row);
		memberMap.set(uid, data);
	});
	log(`  Collected ${memberMap.size} active member records`);

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

	log("  Parsing uc_members...");
	const inserter = loader.createStreamInserter("users");
	const userIds = new Set<number>();

	await parseDumpFile(ucDump, "uc_members", (row) => {
		const uid = Number(row[0]);
		const member = memberMap.get(uid) ?? archiveMap.get(uid) ?? null;
		const isArchived = !memberMap.has(uid) && archiveMap.has(uid);
		const counts = countMap.get(uid) ?? null;
		const record = extractUser(row, member, counts, isArchived);
		inserter.add(record);
		userIds.add(uid);
	});
	const total = inserter.flush();
	log(`  Users: ${total} rows inserted`);
	return { total, userIds };
}

// ─── Step 3: Threads ────────────────────────────────────────────────────────

export async function migrateThreads(
	loader: BatchLoader,
	sourceDir: string,
): Promise<{ total: number; skipped: number; threadIds: Set<number> }> {
	log("=== Threads ===");
	const dumpFile = `${sourceDir}/thread.sql.gz`;
	const inserter = loader.createStreamInserter("threads");
	const threadIds = new Set<number>();
	let skipped = 0;

	await parseDumpFile(dumpFile, "pre_forum_thread", (row) => {
		const record = extractThread(row);
		if (record) {
			inserter.add(record);
			threadIds.add(record.id as number);
		} else {
			skipped++;
		}
	});
	const total = inserter.flush();
	log(`  Threads: ${total} inserted, ${skipped} skipped (hidden/merged)`);
	return { total, skipped, threadIds };
}

// ─── Step 4: Posts ──────────────────────────────────────────────────────────

export interface PostMigrateResult {
	total: number;
	filtered: number;
	encodingRepaired: number;
	bbcodeFailures: number;
	orphanThread: number;
	orphanAuthor: number;
	postIds: Set<number>;
}

/**
 * Migrate posts with orphan detection per docs/03-migration.md:
 * - author_id not in users → report + abort
 * - thread_id not in threads → skip + log to migration.log
 */
export async function migratePosts(
	loader: BatchLoader,
	sourceDir: string,
	userIds: Set<number>,
	threadIds: Set<number>,
	logger: MigrationLogger,
): Promise<PostMigrateResult> {
	log("=== Posts ===");
	const stats = {
		total: 0,
		filtered: 0,
		encodingRepaired: 0,
		bbcodeFailures: 0,
		onBbcodeFailure: (pid: number, error: string) => logger.logBbcodeFailure(pid, error),
		onEncodingFailure: (pid: number, issue: string) => logger.logEncodingFailure(pid, issue),
	};
	const inserter = loader.createStreamInserter("posts");
	const postIds = new Set<number>();
	let orphanThread = 0;
	let orphanAuthor = 0;

	const processRow = (row: ParsedRow) => {
		const record = extractPost(row, stats);
		if (!record) return;

		const tid = record.thread_id as number;
		const aid = record.author_id as number;
		const pid = record.id as number;

		// FK check: thread_id must exist in migrated threads
		if (!threadIds.has(tid)) {
			orphanThread++;
			logger.logOrphan("post", pid, tid, "thread_id not in threads (hidden/merged)");
			return; // Skip this post
		}

		// FK check: author_id must exist in migrated users
		// Per docs: "报告 + 中止" — but we log and continue to collect all orphans,
		// then abort after the table is done if any author orphans were found.
		if (!userIds.has(aid)) {
			orphanAuthor++;
			logger.logOrphan("post", pid, aid, "author_id not in users");
			return;
		}

		inserter.add(record);
		postIds.add(pid);
	};

	const mainDump = `${sourceDir}/post_main.sql.gz`;
	log("  Parsing pre_forum_post (main)...");
	await parseDumpFile(mainDump, "pre_forum_post", processRow);

	const shardDump = `${sourceDir}/post_shards.sql.gz`;
	for (let i = 1; i <= 4; i++) {
		const tableName = `pre_forum_post_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(shardDump, tableName, processRow);
	}

	const total = inserter.flush();
	stats.total = total;
	log(
		`  Posts: ${total} inserted, ${stats.filtered} invisible, ${orphanThread} orphan-thread, ${orphanAuthor} orphan-author`,
	);

	// Per docs/03-migration.md: author_id orphans should abort
	if (orphanAuthor > 0) {
		throw new Error(
			`${orphanAuthor} posts have author_id not in users — data source issue. See migration.log`,
		);
	}

	return { ...stats, orphanThread, orphanAuthor, postIds };
}

// ─── Step 5: Attachments ────────────────────────────────────────────────────

export async function migrateAttachments(
	loader: BatchLoader,
	sourceDir: string,
	postIds: Set<number>,
	logger: MigrationLogger,
): Promise<{ total: number; skipped: number; orphanPost: number }> {
	log("=== Attachments ===");
	const dumpFile = `${sourceDir}/main_small.sql.gz`;

	log("  Parsing pre_forum_attachment (index)...");
	const indexMap = new Map<number, AttachmentIndexData>();
	await parseDumpFile(dumpFile, "pre_forum_attachment", (row) => {
		const idx = parseAttachmentIndex(row);
		indexMap.set(idx.aid, idx);
	});
	log(`  Collected ${indexMap.size} attachment index records`);

	const inserter = loader.createStreamInserter("attachments");
	let skipped = 0;
	let orphanPost = 0;

	for (let i = 0; i <= 9; i++) {
		const tableName = `pre_forum_attachment_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(dumpFile, tableName, (row) => {
			const record = extractAttachment(row, indexMap);
			if (!record) {
				skipped++;
				return;
			}

			// FK check: post_id must exist in migrated posts
			const pid = record.post_id as number;
			if (!postIds.has(pid)) {
				orphanPost++;
				logger.logOrphan(
					"attachment",
					record.id as number,
					pid,
					"post_id not in posts (invisible)",
				);
				return;
			}

			inserter.add(record);
		});
	}

	const total = inserter.flush();
	log(`  Attachments: ${total} inserted, ${skipped} no-index, ${orphanPost} orphan-post`);
	return { total, skipped, orphanPost };
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

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

	// Initialize logger
	const { mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	const outputDir = dirname(config.dbPath);
	mkdirSync(outputDir, { recursive: true });
	const logger = new MigrationLogger({ outputDir });
	logger.init();

	const loader = new BatchLoader({
		dbPath: config.dbPath,
		batchSize: config.batchSize,
		progressInterval: config.progressInterval,
		onProgress: (table, count) => {
			log(`  [${table}] ${count.toLocaleString()} rows...`);
		},
	});

	try {
		log("Creating tables...");
		loader.createTables();

		// Migrate in FK dependency order, collecting ID sets for orphan detection
		stats.forums = await migrateForums(loader, config.sourceDir);

		const userResult = await migrateUsers(loader, config.sourceDir);
		stats.users = userResult.total;

		const threadResult = await migrateThreads(loader, config.sourceDir);
		stats.threads = threadResult.total;
		stats.skipped.threads = threadResult.skipped;

		const postResult = await migratePosts(
			loader,
			config.sourceDir,
			userResult.userIds,
			threadResult.threadIds,
			logger,
		);
		stats.posts = postResult.total;
		stats.skipped.posts = postResult.filtered;
		stats.skipped.postOrphanThread = postResult.orphanThread;

		const attachResult = await migrateAttachments(
			loader,
			config.sourceDir,
			postResult.postIds,
			logger,
		);
		stats.attachments = attachResult.total;
		stats.skipped.attachments = attachResult.skipped;
		stats.skipped.attachOrphanPost = attachResult.orphanPost;

		// Create indexes after all data is loaded (much faster)
		log("Creating indexes...");
		loader.createIndexes();
		log("Indexes created");

		// Run verification suite per docs/03-migration.md
		log("=== Verification ===");
		const db = loader.getDb();
		const expected: ExpectedCounts = {
			forums: stats.forums,
			users: stats.users,
			threads: stats.threads,
			posts: stats.posts,
			attachments: stats.attachments,
		};

		const intReport = verifyIntegrity(db, expected);
		log(`  Integrity: ${intReport.summary}`);
		if (!intReport.passed) {
			for (const c of intReport.checks.filter((c) => !c.passed)) {
				log(`    FAIL: ${c.name} — expected ${c.expected}, got ${c.actual}`);
			}
		}

		const encReport = verifyEncoding(db, 1000);
		log(`  Encoding: ${encReport.summary}`);

		const perfReport = verifyPerformance(db);
		log(`  Performance: ${perfReport.summary}`);
		for (const b of perfReport.benchmarks) {
			log(`    ${b.passed ? "✓" : "✗"} ${b.name}: ${b.durationMs}ms (index: ${b.usesIndex})`);
		}

		// Log summary counts
		const logCounts = logger.getCounts();
		if (logCounts.orphans > 0) {
			log(`  Orphan records logged: ${logCounts.orphans} (see migration.log)`);
		}
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

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
	const overrides = parseCliArgs(process.argv.slice(2));
	const config: MigrateConfig = { ...DEFAULT_CONFIG, ...overrides };

	const { mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	mkdirSync(dirname(config.dbPath), { recursive: true });

	const result = await runMigration(config);
	if (result.errors.length > 0) {
		process.exit(1);
	}
}
