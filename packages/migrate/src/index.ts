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
	type MemberFieldForumData,
	type ProfileData,
	type StatusData,
	type UsergroupData,
	extractAttachment,
	extractForum,
	extractPost,
	extractThread,
	extractUser,
	parseAttachmentIndex,
	parseMemberCountRow,
	parseMemberFieldForumRow,
	parseMemberRow,
	parseProfileRow,
	parseStatusRow,
	parseThreadTypeRow,
	parseUsergroupRow,
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
	const extraDump = `${sourceDir}/user_extra.sql.gz`;

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
		await parseDumpFile(extraDump, "pre_common_member_count", (row) => {
			const { uid, data } = parseMemberCountRow(row);
			countMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${countMap.size} member count records`);

	log("  Parsing pre_common_member_count_archive...");
	try {
		await parseDumpFile(extraDump, "pre_common_member_count_archive", (row) => {
			const { uid, data } = parseMemberCountRow(row);
			if (!countMap.has(uid)) countMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Total member count records: ${countMap.size}`);

	log("  Parsing pre_common_usergroup...");
	const usergroupMap = new Map<number, UsergroupData>();
	try {
		await parseDumpFile(extraDump, "pre_common_usergroup", (row) => {
			const { groupid, data } = parseUsergroupRow(row);
			usergroupMap.set(groupid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${usergroupMap.size} usergroup records`);

	log("  Parsing pre_common_member_field_forum...");
	const fieldForumMap = new Map<number, MemberFieldForumData>();
	try {
		await parseDumpFile(extraDump, "pre_common_member_field_forum", (row) => {
			const { uid, data } = parseMemberFieldForumRow(row);
			fieldForumMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${fieldForumMap.size} field_forum records`);

	log("  Parsing pre_common_member_field_forum_archive...");
	try {
		await parseDumpFile(extraDump, "pre_common_member_field_forum_archive", (row) => {
			const { uid, data } = parseMemberFieldForumRow(row);
			if (!fieldForumMap.has(uid)) fieldForumMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Total field_forum records: ${fieldForumMap.size}`);

	log("  Parsing pre_common_member_profile...");
	const profileMap = new Map<number, ProfileData>();
	try {
		await parseDumpFile(extraDump, "pre_common_member_profile", (row) => {
			const { uid, data } = parseProfileRow(row);
			profileMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${profileMap.size} profile records`);

	log("  Parsing pre_common_member_profile_archive...");
	try {
		await parseDumpFile(extraDump, "pre_common_member_profile_archive", (row) => {
			const { uid, data } = parseProfileRow(row);
			if (!profileMap.has(uid)) profileMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Total profile records: ${profileMap.size}`);

	log("  Parsing pre_common_member_status...");
	const statusMap = new Map<number, StatusData>();
	try {
		await parseDumpFile(extraDump, "pre_common_member_status", (row) => {
			const { uid, data } = parseStatusRow(row);
			statusMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${statusMap.size} status records`);

	log("  Parsing pre_common_member_status_archive...");
	try {
		await parseDumpFile(extraDump, "pre_common_member_status_archive", (row) => {
			const { uid, data } = parseStatusRow(row);
			if (!statusMap.has(uid)) statusMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Total status records: ${statusMap.size}`);

	log("  Parsing uc_members...");
	const inserter = loader.createStreamInserter("users");
	const userIds = new Set<number>();

	await parseDumpFile(ucDump, "uc_members", (row) => {
		const uid = Number(row[0]);
		const member = memberMap.get(uid) ?? archiveMap.get(uid) ?? null;
		const isArchived = !memberMap.has(uid) && archiveMap.has(uid);
		const counts = countMap.get(uid) ?? null;

		// Look up usergroup via member's groupid
		const ug = member?.groupid ? (usergroupMap.get(member.groupid) ?? null) : null;

		const record = extractUser(row, member, counts, isArchived, {
			fieldForum: fieldForumMap.get(uid) ?? null,
			profile: profileMap.get(uid) ?? null,
			status: statusMap.get(uid) ?? null,
			usergroup: ug,
		});
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
	forumIds: Set<number>,
	userIds: Set<number>,
): Promise<{
	total: number;
	skipped: number;
	threadIds: Set<number>;
	missingForums: number;
	missingAuthors: number;
}> {
	log("=== Threads ===");
	const dumpFile = `${sourceDir}/thread.sql.gz`;
	const extraDump = `${sourceDir}/user_extra.sql.gz`;

	// Build threadTypeMap from user_extra dump
	log("  Parsing pre_forum_threadtype...");
	const threadTypeMap = new Map<number, string>();
	try {
		await parseDumpFile(extraDump, "pre_forum_threadtype", (row) => {
			const { typeid, name } = parseThreadTypeRow(row);
			if (typeid > 0 && name) threadTypeMap.set(typeid, name);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${threadTypeMap.size} thread type records`);

	const inserter = loader.createStreamInserter("threads");
	const threadIds = new Set<number>();
	const missingForumIds = new Set<number>();
	const missingAuthorIds = new Set<number>();
	let skipped = 0;

	await parseDumpFile(dumpFile, "pre_forum_thread", (row) => {
		const record = extractThread(row, threadTypeMap);
		if (record) {
			inserter.add(record);
			threadIds.add(record.id as number);

			const fid = record.forum_id as number;
			if (!forumIds.has(fid)) {
				missingForumIds.add(fid);
			}
			const aid = record.author_id as number;
			if (!userIds.has(aid)) {
				missingAuthorIds.add(aid);
			}
		} else {
			skipped++;
		}
	});
	const total = inserter.flush();
	log(`  Threads: ${total} inserted, ${skipped} skipped (corrupt rows)`);

	// Create placeholder forums for missing forum_ids
	if (missingForumIds.size > 0) {
		log(`  Creating ${missingForumIds.size} placeholder forums for deleted forums...`);
		const forumInserter = loader.createStreamInserter("forums");
		for (const fid of missingForumIds) {
			forumInserter.add({
				id: fid,
				parent_id: 0,
				name: `[已删除版块${fid}]`,
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: -1, // Placeholder status
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_thread_subject: "",
			});
			forumIds.add(fid);
		}
		const placeholders = forumInserter.flush();
		log(`  Created ${placeholders} placeholder forums`);
	}

	// Create placeholder users for missing author_ids
	if (missingAuthorIds.size > 0) {
		log(`  Creating ${missingAuthorIds.size} placeholder users for deleted thread authors...`);
		const userInserter = loader.createStreamInserter("users");
		for (const uid of missingAuthorIds) {
			userInserter.add({
				id: uid,
				username: `[已删除用户${uid}]`,
				email: "",
				password_hash: "",
				password_salt: "",
				avatar: "",
				status: -3, // Placeholder status
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
				signature: "",
				group_title: "",
				group_stars: 0,
				group_color: "",
				custom_title: "",
				digest_posts: 0,
				ol_time: 0,
				gender: 0,
				birth_year: 0,
				birth_month: 0,
				birth_day: 0,
				reside_province: "",
				reside_city: "",
				graduate_school: "",
				bio: "",
				interest: "",
				qq: "",
				site: "",
				last_activity: 0,
			});
			userIds.add(uid);
		}
		const placeholders = userInserter.flush();
		log(`  Created ${placeholders} placeholder users`);
	}

	return {
		total,
		skipped,
		threadIds,
		missingForums: missingForumIds.size,
		missingAuthors: missingAuthorIds.size,
	};
}

// ─── Step 4: Posts ──────────────────────────────────────────────────────────

export interface PostMigrateResult {
	total: number;
	filtered: number;
	encodingRepaired: number;
	bbcodeFailures: number;
	missingAuthors: number;
	missingThreads: number;
	orphanThread: number;
	orphanAuthor: number;
	postIds: Set<number>;
}

/**
 * Migrate posts. Creates placeholder users for missing author_ids
 * and placeholder threads for missing thread_ids.
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

	return { ...stats, orphanThread, orphanAuthor, postIds, missingAuthors: 0, missingThreads: 0 };
}

// ─── Step 5: Attachments ────────────────────────────────────────────────────

export async function migrateAttachments(
	loader: BatchLoader,
	sourceDir: string,
	postIds: Set<number>,
	threadIds: Set<number>,
	_logger: MigrationLogger,
): Promise<{ total: number; skipped: number; missingPosts: number; missingThreads: number }> {
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
	const missingPostIds = new Set<number>();
	const missingThreadIds = new Set<number>();

	for (let i = 0; i <= 9; i++) {
		const tableName = `pre_forum_attachment_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(dumpFile, tableName, (row) => {
			const record = extractAttachment(row, indexMap);
			if (!record) {
				skipped++;
				return;
			}

			// Collect missing post_ids for placeholder creation
			const pid = record.post_id as number;
			if (!postIds.has(pid)) {
				missingPostIds.add(pid);
			}

			// Collect missing thread_ids for placeholder creation
			const tid = record.thread_id as number;
			if (!threadIds.has(tid)) {
				missingThreadIds.add(tid);
			}

			inserter.add(record);
		});
	}

	const total = inserter.flush();

	// Create placeholder threads for missing thread_ids
	if (missingThreadIds.size > 0) {
		log(`  Creating ${missingThreadIds.size} placeholder threads for orphan attachments...`);
		const threadInserter = loader.createStreamInserter("threads");
		for (const tid of missingThreadIds) {
			threadInserter.add({
				id: tid,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				subject: `[已删除主题${tid}]`,
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				replies: 0,
				views: 0,
				closed: 0,
				sticky: -99,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				post_table_id: 0,
				type_name: "",
			});
			threadIds.add(tid);
		}
		const placeholders = threadInserter.flush();
		log(`  Created ${placeholders} placeholder threads`);
	}

	// Create placeholder posts for missing post_ids
	if (missingPostIds.size > 0) {
		log(`  Creating ${missingPostIds.size} placeholder posts for orphan attachments...`);
		const postInserter = loader.createStreamInserter("posts");
		for (const pid of missingPostIds) {
			postInserter.add({
				id: pid,
				thread_id: 0,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				content: "[已删除帖子]",
				created_at: 0,
				is_first: 0,
				position: 0,
				invisible: -1, // Placeholder
			});
			postIds.add(pid);
		}
		const placeholders = postInserter.flush();
		log(`  Created ${placeholders} placeholder posts`);
	}

	log(
		`  Attachments: ${total} inserted, ${skipped} no-index, ${missingPostIds.size} missing posts, ${missingThreadIds.size} missing threads`,
	);
	return {
		total,
		skipped,
		missingPosts: missingPostIds.size,
		missingThreads: missingThreadIds.size,
	};
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

		// Collect forumIds for thread FK validation
		const forumIds = new Set<number>();
		{
			const forumRows = loader.getDb().query("SELECT id FROM forums").all() as Array<{
				id: number;
			}>;
			for (const r of forumRows) forumIds.add(r.id);
		}

		const threadResult = await migrateThreads(
			loader,
			config.sourceDir,
			forumIds,
			userResult.userIds,
		);
		stats.threads = threadResult.total;
		stats.skipped.threads = threadResult.skipped;
		stats.skipped.threadMissingForums = threadResult.missingForums;
		stats.skipped.threadMissingAuthors = threadResult.missingAuthors;

		const postResult = await migratePosts(
			loader,
			config.sourceDir,
			userResult.userIds,
			threadResult.threadIds,
			logger,
		);
		stats.posts = postResult.total;
		stats.skipped.missingAuthors = postResult.missingAuthors;
		stats.skipped.missingThreads = postResult.missingThreads;

		const attachResult = await migrateAttachments(
			loader,
			config.sourceDir,
			postResult.postIds,
			threadResult.threadIds,
			logger,
		);
		stats.attachments = attachResult.total;
		stats.skipped.attachments = attachResult.skipped;
		stats.skipped.attachMissingPosts = attachResult.missingPosts;
		stats.skipped.attachMissingThreads = attachResult.missingThreads;

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
