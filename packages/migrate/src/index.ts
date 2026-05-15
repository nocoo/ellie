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
 *   forums → users → threads → posts → attachments → post_comments → user_checkins
 */

import { DEFAULT_CONFIG, type MigrateConfig, parseCliArgs } from "./cli";
import {
	type AttachmentIndexData,
	type MemberCountData,
	type MemberData,
	type MemberFieldForumData,
	type ProfileData,
	type StatusData,
	type ThreadClassRow,
	type UsergroupData,
	extractAttachment,
	extractCheckin,
	extractForum,
	extractPost,
	extractPostComment,
	extractThread,
	extractUser,
	parseAttachmentIndex,
	parseMemberCountRow,
	parseMemberFieldForumRow,
	parseMemberRow,
	parseProfileRow,
	parseStatusRow,
	parseThreadClassRow,
	parseThreadTypeRow,
	parseUsergroupRow,
} from "./extract/extractors";
import { type ParsedRow, parseDumpFile } from "./extract/parser";
import { type SourceFiles, resolveSourceFiles } from "./extract/source-resolver";
import { BatchLoader } from "./load/batch-insert";
import { MigrationLogger } from "./load/logger";
import { CHECKINS_UPSERT_COLUMNS } from "./load/schema";
import { createDeletedUserPlaceholder } from "./load/sql-builder";
import { buildForumThreadTypeRows } from "./transform/forum-thread-types";
import { type ThreadTypesConfig, parseThreadTypes } from "./transform/threadtypes";
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
	post_comments: number;
	checkins: number;
	skipped: { [key: string]: number };
	errors: string[];
	duration: number;
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

// ─── Step 1: Forums ─────────────────────────────────────────────────────────

export async function migrateForums(
	loader: BatchLoader,
	sources: SourceFiles,
): Promise<{
	total: number;
	forumTypeConfigs: Map<number, ThreadTypesConfig>;
}> {
	log("=== Forums ===");

	log("  Parsing pre_forum_forumfield...");
	const forumFields = new Map<number, { description: string; icon: string; moderators: string }>();
	// Per-forum 主题分类 config parsed from forumfield.threadtypes
	// (PHP-serialized). Built here so `extractForum` can emit the four
	// thread_types_* flag columns in the same pass. See migration 0038.
	const forumTypeConfigs = new Map<number, ThreadTypesConfig>();
	await parseDumpFile(sources.forums, "pre_forum_forumfield", (row) => {
		// forumfield columns verified from DDL: fid=0, description=1, password=2, icon=3, ...moderators=8, ...threadtypes=10
		const fid = Number(row[0]);
		const description = row[1] ?? "";
		const icon = row[3] ?? "";
		const rawMods = row[8] ?? "";
		const threadtypes = row[10] ?? "";
		// Moderators are tab-separated in DZ; normalize to comma-separated
		const moderators = rawMods
			.split("\t")
			.map((s) => s.trim())
			.filter(Boolean)
			.join(", ");
		forumFields.set(fid, { description, icon, moderators });
		// Only retain configs with at least one parsed type (saves
		// memory on the long tail of forums with no admin categories
		// while preserving full fidelity for the four flag columns).
		if (threadtypes) {
			const cfg = parseThreadTypes(threadtypes);
			if (cfg.enabled || cfg.required || cfg.listable || cfg.prefix || cfg.types.size > 0) {
				forumTypeConfigs.set(fid, cfg);
			}
		}
	});
	log(
		`  Collected ${forumFields.size} forum field records (${forumTypeConfigs.size} with thread_types)`,
	);

	log("  Parsing pre_forum_forum...");
	const inserter = loader.createStreamInserter("forums");
	await parseDumpFile(sources.forums, "pre_forum_forum", (row) => {
		const record = extractForum(row, forumFields, forumTypeConfigs);
		if (record) inserter.add(record);
	});
	const total = inserter.flush();
	log(`  Forums: ${total} rows inserted`);
	return { total, forumTypeConfigs };
}

// ─── Step 1b: forum_thread_types ─────────────────────────────────────────────

/**
 * Build & insert `forum_thread_types` rows + return the per-forum
 * (typeid → name) resolution map used by `migrateThreads` to fill
 * `threads.type_name`, plus the (fid, source_typeid → synthetic id)
 * translation map used to write `threads.type_id`.
 *
 * Inputs come from two Discuz sources (see transform/forum-thread-types):
 *   • forumTypeConfigs — parsed from `pre_forum_forumfield.threadtypes`,
 *     produced as a side effect of `migrateForums`.
 *   • pre_forum_threadclass — parsed here.
 *
 * Reviewer merge policy (msg 73d85116):
 *   • Enabled-set names + display_order come from forumfield.types.
 *   • threadclass only fills in tombstone rows (typeids dropped from
 *     forumfield.types but still referenced by old `thread.typeid`),
 *     plus icon / display_order / moderator fallbacks for enabled rows.
 *
 * Synthetic-id semantics (migration 0039): `forum_thread_types.id` is a
 * minted global counter, not the source Discuz typeid. The source value
 * is preserved in `forum_thread_types.source_typeid` and surfaced in
 * the dry-run mapping artifact for debug.
 */
export async function migrateForumThreadTypes(
	loader: BatchLoader,
	sources: SourceFiles,
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
): Promise<{
	total: number;
	forumThreadTypeNameMap: Map<number, Map<number, string>>;
	syntheticIdMap: Map<number, Map<number, number>>;
	threadClassRowCount: number;
	mappingArtifact: ReturnType<typeof buildForumThreadTypeRows>;
}> {
	log("=== Forum thread types ===");

	log("  Parsing pre_forum_threadclass...");
	const threadClassByForum = new Map<number, ThreadClassRow[]>();
	try {
		await parseDumpFile(sources.forums, "pre_forum_threadclass", (row) => {
			const cls = parseThreadClassRow(row);
			if (!cls.typeid || !cls.fid) return;
			const arr = threadClassByForum.get(cls.fid);
			if (arr) arr.push(cls);
			else threadClassByForum.set(cls.fid, [cls]);
		});
	} catch {
		// Table may not exist in older dumps — that's OK; tombstones
		// won't be populated but the enabled-set still loads.
	}
	const classRowCount = [...threadClassByForum.values()].reduce((n, arr) => n + arr.length, 0);
	log(`  Collected ${classRowCount} threadclass rows across ${threadClassByForum.size} forums`);

	// Reviewer pin a42e7d1f: a non-empty forumfield.types config but
	// zero threadclass rows is a strong signal that the dump source is
	// missing pre_forum_threadclass (e.g. a future split dump that
	// hasn't been updated). Without threadclass, historical typeids
	// dropped from forumfield.types lose their tombstone — old threads
	// would render an empty type_name. Promote to WARN so it isn't
	// buried in the per-step counts.
	if (forumTypeConfigs.size > 0 && classRowCount === 0) {
		log(
			"  WARN: pre_forum_threadclass yielded 0 rows but forumfield.threadtypes is non-empty — historical tombstones will be missing. Verify the dump source includes pre_forum_threadclass.",
		);
	}

	const result = buildForumThreadTypeRows(forumTypeConfigs, threadClassByForum);

	const inserter = loader.createStreamInserter("forum_thread_types");
	for (const r of result.rows) inserter.add(r);
	const total = inserter.flush();
	log(`  forum_thread_types: ${total} rows inserted`);
	if (result.sourceTypeidGlobalDuplicates.length > 0) {
		// Reviewer pin 3d056b39 #4: surface the cross-forum source_typeid
		// collisions that were the entire reason 0039 exists. A non-zero
		// count is expected on real Discuz data; zero would actually be
		// surprising and worth checking the parser.
		log(
			`  source_typeid global duplicates: ${result.sourceTypeidGlobalDuplicates.length} (expected: typeid 0/1/2 reuse across fids)`,
		);
	}
	if (result.zeroTypeidDefinitions.length > 0) {
		// reviewer pin c5d10236: source_typeid=0 is intentionally NOT
		// emitted as an enabled row; record what we skipped so admin/debug
		// has a clear trail.
		log(
			`  zero-typeid definitions skipped: ${result.zeroTypeidDefinitions.length} (kept in mapping artifact only)`,
		);
	}
	return {
		total,
		forumThreadTypeNameMap: result.nameMap,
		syntheticIdMap: result.syntheticIdMap,
		threadClassRowCount: classRowCount,
		mappingArtifact: result,
	};
}

// ─── Step 2: Users ──────────────────────────────────────────────────────────

export async function migrateUsers(
	loader: BatchLoader,
	sources: SourceFiles,
): Promise<{ total: number; userIds: Set<number> }> {
	log("=== Users ===");

	log("  Parsing pre_common_member...");
	const memberMap = new Map<number, MemberData>();
	await parseDumpFile(sources.members, "pre_common_member", (row) => {
		const { uid, data } = parseMemberRow(row);
		memberMap.set(uid, data);
	});
	log(`  Collected ${memberMap.size} active member records`);

	log("  Parsing pre_common_member_archive...");
	const archiveMap = new Map<number, MemberData>();
	try {
		await parseDumpFile(sources.members, "pre_common_member_archive", (row) => {
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
		await parseDumpFile(sources.memberCount, "pre_common_member_count", (row) => {
			const { uid, data } = parseMemberCountRow(row);
			countMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${countMap.size} member count records`);

	log("  Parsing pre_common_member_count_archive...");
	try {
		await parseDumpFile(sources.memberCount, "pre_common_member_count_archive", (row) => {
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
		await parseDumpFile(sources.usergroup, "pre_common_usergroup", (row) => {
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
		await parseDumpFile(sources.memberFieldForum, "pre_common_member_field_forum", (row) => {
			const { uid, data } = parseMemberFieldForumRow(row);
			fieldForumMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${fieldForumMap.size} field_forum records`);

	log("  Parsing pre_common_member_field_forum_archive...");
	try {
		await parseDumpFile(
			sources.memberFieldForum,
			"pre_common_member_field_forum_archive",
			(row) => {
				const { uid, data } = parseMemberFieldForumRow(row);
				if (!fieldForumMap.has(uid)) fieldForumMap.set(uid, data);
			},
		);
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Total field_forum records: ${fieldForumMap.size}`);

	log("  Parsing pre_common_member_profile...");
	const profileMap = new Map<number, ProfileData>();
	try {
		await parseDumpFile(sources.memberProfile, "pre_common_member_profile", (row) => {
			const { uid, data } = parseProfileRow(row);
			profileMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${profileMap.size} profile records`);

	log("  Parsing pre_common_member_profile_archive...");
	try {
		await parseDumpFile(sources.memberProfile, "pre_common_member_profile_archive", (row) => {
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
		await parseDumpFile(sources.memberStatus, "pre_common_member_status", (row) => {
			const { uid, data } = parseStatusRow(row);
			statusMap.set(uid, data);
		});
	} catch {
		// Table may not exist — that's OK
	}
	log(`  Collected ${statusMap.size} status records`);

	log("  Parsing pre_common_member_status_archive...");
	try {
		await parseDumpFile(sources.memberStatus, "pre_common_member_status_archive", (row) => {
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

	await parseDumpFile(sources.ucMembers, "uc_members", (row) => {
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
	sources: SourceFiles,
	forumIds: Set<number>,
	userIds: Set<number>,
	forumThreadTypeNameMap?: Map<number, Map<number, string>>,
	syntheticIdMap?: Map<number, Map<number, number>>,
): Promise<{
	total: number;
	skipped: number;
	threadIds: Set<number>;
	missingForums: number;
	missingAuthors: number;
	unmappedTypeids: {
		total: number;
		distinct: number;
		topByCount: Array<{ fid: number; typeid: number; count: number }>;
	};
}> {
	log("=== Threads ===");

	// Build threadTypeMap
	log("  Parsing pre_forum_threadtype...");
	const threadTypeMap = new Map<number, string>();
	if (sources.threadtype) {
		try {
			await parseDumpFile(sources.threadtype, "pre_forum_threadtype", (row) => {
				const { typeid, name } = parseThreadTypeRow(row);
				if (typeid > 0 && name) threadTypeMap.set(typeid, name);
			});
		} catch {
			// Table may not exist — that's OK
		}
	}
	log(`  Collected ${threadTypeMap.size} thread type records`);

	const inserter = loader.createStreamInserter("threads");
	const threadIds = new Set<number>();
	const missingForumIds = new Set<number>();
	const missingAuthorIds = new Set<number>();
	let skipped = 0;
	// Reviewer pin 51fa5901: track source typeids that have no synthetic-id
	// mapping (i.e. forum_thread_types has no row for this (fid, source_typeid)
	// pair) — these are exactly the typeids historical threads reference but
	// neither forumfield.types nor threadclass declared. A high count
	// indicates either a missing dump source or a parser regression. The
	// synthetic-id rewrite (0039) collapses the previous "unmapped name"
	// signal into "unmapped synthetic id" — same intent, more accurate
	// reporting since the synthetic-id map and the name map are now built
	// from the exact same union of sources.
	const unmappedCounts = new Map<string, { fid: number; typeid: number; count: number }>();
	let unmappedTotal = 0;

	const processThreadRow = (row: ParsedRow) => {
		const record = extractThread(row, threadTypeMap, forumThreadTypeNameMap, syntheticIdMap);
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

			// Re-read raw source typeid; record.type_id is now the
			// synthetic id (0 when unmapped). The "unmapped" predicate
			// is `source typeid > 0 AND synthetic id is 0` — the source
			// asked for a category but we had no row for it.
			const sourceTypeid = Number(row[3]) || 0; // THREAD_COLS.typeid = 3
			if (sourceTypeid > 0 && (record.type_id as number) === 0) {
				unmappedTotal++;
				const key = `${fid}:${sourceTypeid}`;
				const entry = unmappedCounts.get(key);
				if (entry) entry.count++;
				else unmappedCounts.set(key, { fid, typeid: sourceTypeid, count: 1 });
			}
		} else {
			skipped++;
		}
	};

	// Parse main thread table
	await parseDumpFile(sources.threads, "pre_forum_thread", processThreadRow);

	// Parse thread shard tables (pre_forum_thread_1, _2, _3, etc.)
	for (let i = 1; i <= 7; i++) {
		const tableName = `pre_forum_thread_${i}`;
		try {
			log(`  Parsing ${tableName}...`);
			await parseDumpFile(sources.threadShards, tableName, processThreadRow);
		} catch {
			// Shard table may not exist or be empty — that's OK
		}
	}

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
				moderators: "",
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
			userInserter.add(createDeletedUserPlaceholder(uid));
			userIds.add(uid);
		}
		const placeholders = userInserter.flush();
		log(`  Created ${placeholders} placeholder users`);
	}

	// Build unmapped typeid report (top 20 by count, deterministic ordering).
	const unmappedTopByCount = [...unmappedCounts.values()]
		.sort((a, b) => b.count - a.count || a.fid - b.fid || a.typeid - b.typeid)
		.slice(0, 20);
	if (unmappedTotal > 0) {
		log(
			`  Unmapped typeids: ${unmappedTotal} threads across ${unmappedCounts.size} (fid,typeid) pairs (top: ${unmappedTopByCount
				.slice(0, 5)
				.map((e) => `fid=${e.fid} typeid=${e.typeid} ×${e.count}`)
				.join(", ")})`,
		);
	}

	return {
		total,
		skipped,
		threadIds,
		missingForums: missingForumIds.size,
		missingAuthors: missingAuthorIds.size,
		unmappedTypeids: {
			total: unmappedTotal,
			distinct: unmappedCounts.size,
			topByCount: unmappedTopByCount,
		},
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
	sources: SourceFiles,
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
	const missingAuthorIds = new Set<number>();

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
		// Collect missing authors to create placeholders later
		if (!userIds.has(aid)) {
			orphanAuthor++;
			missingAuthorIds.add(aid);
			logger.logOrphan("post", pid, aid, "author_id not in users");
		}

		inserter.add(record);
		postIds.add(pid);
	};

	const mainDump = sources.posts;
	log("  Parsing pre_forum_post (main)...");
	await parseDumpFile(mainDump, "pre_forum_post", processRow);

	for (let i = 1; i <= 4; i++) {
		const tableName = `pre_forum_post_${i}`;
		log(`  Parsing ${tableName}...`);
		await parseDumpFile(sources.postShards, tableName, processRow);
	}

	const total = inserter.flush();
	stats.total = total;
	log(
		`  Posts: ${total} inserted, ${stats.filtered} invisible, ${orphanThread} orphan-thread, ${orphanAuthor} orphan-author`,
	);

	// Create placeholder users for missing post authors (deleted users with remaining posts)
	if (missingAuthorIds.size > 0) {
		log(`  Creating ${missingAuthorIds.size} placeholder users for deleted post authors...`);
		const userInserter = loader.createStreamInserter("users");
		for (const uid of missingAuthorIds) {
			userInserter.add(createDeletedUserPlaceholder(uid));
			userIds.add(uid);
		}
		const placeholders = userInserter.flush();
		log(`  Created ${placeholders} placeholder users for post authors`);
	}

	return {
		...stats,
		orphanThread,
		orphanAuthor,
		postIds,
		missingAuthors: missingAuthorIds.size,
		missingThreads: 0,
	};
}

// ─── Step 5: Attachments ────────────────────────────────────────────────────

export async function migrateAttachments(
	loader: BatchLoader,
	sources: SourceFiles,
	postIds: Set<number>,
	threadIds: Set<number>,
	_logger: MigrationLogger,
): Promise<{ total: number; skipped: number; missingPosts: number; missingThreads: number }> {
	log("=== Attachments ===");

	log("  Parsing pre_forum_attachment (index)...");
	const indexMap = new Map<number, AttachmentIndexData>();
	await parseDumpFile(sources.attachments, "pre_forum_attachment", (row) => {
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
		await parseDumpFile(sources.attachments, tableName, (row) => {
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

// ─── Step 6: Post Comments (点评) ───────────────────────────────────────────

/**
 * Migrate post_comments from pre_forum_postcomment.
 *
 * FKs: thread_id → threads, post_id → posts, author_id → users.
 * Missing FK targets get placeholder rows (mirrors attachments strategy)
 * so post_comments rows survive without dropping.
 */
export async function migratePostComments(
	loader: BatchLoader,
	sources: SourceFiles,
	userIds: Set<number>,
	threadIds: Set<number>,
	postIds: Set<number>,
): Promise<{
	total: number;
	missingUsers: number;
	missingThreads: number;
	missingPosts: number;
}> {
	log("=== Post Comments ===");

	if (!sources.postcomments) {
		log("  No postcomment dump found — skipping");
		return { total: 0, missingUsers: 0, missingThreads: 0, missingPosts: 0 };
	}

	const inserter = loader.createStreamInserter("post_comments");
	const missingUserIds = new Set<number>();
	const missingThreadIds = new Set<number>();
	const missingPostIds = new Set<number>();

	log("  Parsing pre_forum_postcomment...");
	await parseDumpFile(sources.postcomments, "pre_forum_postcomment", (row) => {
		const record = extractPostComment(row);
		if (!record) return;

		const aid = record.author_id as number;
		if (aid > 0 && !userIds.has(aid)) {
			missingUserIds.add(aid);
		}
		const tid = record.thread_id as number;
		if (tid > 0 && !threadIds.has(tid)) {
			missingThreadIds.add(tid);
		}
		const pid = record.post_id as number;
		if (pid > 0 && !postIds.has(pid)) {
			missingPostIds.add(pid);
		}

		inserter.add(record);
	});

	const total = inserter.flush();

	if (missingUserIds.size > 0) {
		log(`  Creating ${missingUserIds.size} placeholder users for orphan post_comments...`);
		const userInserter = loader.createStreamInserter("users");
		for (const uid of missingUserIds) {
			userInserter.add(createDeletedUserPlaceholder(uid));
			userIds.add(uid);
		}
		const placeholders = userInserter.flush();
		log(`  Created ${placeholders} placeholder users for post_comments`);
	}

	if (missingThreadIds.size > 0) {
		log(`  Creating ${missingThreadIds.size} placeholder threads for orphan post_comments...`);
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
		log(`  Created ${placeholders} placeholder threads for post_comments`);
	}

	if (missingPostIds.size > 0) {
		log(`  Creating ${missingPostIds.size} placeholder posts for orphan post_comments...`);
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
				invisible: -1,
			});
			postIds.add(pid);
		}
		const placeholders = postInserter.flush();
		log(`  Created ${placeholders} placeholder posts for post_comments`);
	}

	log(
		`  Post Comments: ${total} inserted, ${missingUserIds.size} missing users, ${missingThreadIds.size} missing threads, ${missingPostIds.size} missing posts`,
	);
	return {
		total,
		missingUsers: missingUserIds.size,
		missingThreads: missingThreadIds.size,
		missingPosts: missingPostIds.size,
	};
}

// ─── Step 7: Checkins ─────────────────────────────────────────────────────

/**
 * Migrate user_checkins from pre_dsu_paulsign + pre_dsu_paulsign2.
 *
 * Merge strategy: primary (paulsign) wins on overlapping UIDs;
 * unique UIDs from paulsign2 are merged in.
 *
 * Uses upsertRowsFiltered with WHERE EXISTS(users) to skip orphan UIDs.
 */
export async function migrateCheckins(
	loader: BatchLoader,
	sources: SourceFiles,
): Promise<{ eligible: number; processed: number; skippedMissingUser: number }> {
	log("=== Checkins ===");

	if (!sources.checkins) {
		log("  No checkins dump found — skipping");
		return { eligible: 0, processed: 0, skippedMissingUser: 0 };
	}

	// Parse primary table
	log("  Parsing pre_dsu_paulsign (primary)...");
	const primaryMap = new Map<number, import("./load/batch-insert").RowRecord>();
	await parseDumpFile(sources.checkins, "pre_dsu_paulsign", (row) => {
		const record = extractCheckin(row);
		if (record) primaryMap.set(record.user_id as number, record);
	});
	log(`  Primary: ${primaryMap.size} rows`);

	// Parse backup table and merge (primary wins on overlap)
	log("  Parsing pre_dsu_paulsign2 (backup)...");
	let overlapCount = 0;
	let uniqueBackup = 0;
	try {
		await parseDumpFile(sources.checkins, "pre_dsu_paulsign2", (row) => {
			const record = extractCheckin(row);
			if (!record) return;
			const uid = record.user_id as number;
			if (primaryMap.has(uid)) {
				overlapCount++;
			} else {
				primaryMap.set(uid, record);
				uniqueBackup++;
			}
		});
	} catch {
		// paulsign2 may not exist — that's OK
	}
	log(`  Backup merge: ${overlapCount} overlaps (kept primary), ${uniqueBackup} unique merged`);
	log(`  Total merged: ${primaryMap.size} rows`);

	// Upsert with WHERE EXISTS(users) filter
	const rows = [...primaryMap.values()];
	const processed = loader.upsertRowsFiltered(
		"user_checkins",
		rows,
		{
			conflictColumn: "user_id",
			updateColumns: CHECKINS_UPSERT_COLUMNS,
		},
		{
			referenceTable: "users",
			referenceColumn: "id",
			sourceColumn: "user_id",
		},
	);

	// Count how many UIDs from this batch actually exist in users (= eligible)
	// This is correct for both fresh and incremental runs, unlike full table COUNT(*)
	const db = loader.getDb();
	const userIds = rows.map((r) => r.user_id);
	let eligible = 0;
	// Query in chunks to avoid SQLite bind-parameter limits
	const chunkSize = 500;
	for (let i = 0; i < userIds.length; i += chunkSize) {
		const chunk = userIds.slice(i, i + chunkSize);
		const placeholders = chunk.map(() => "?").join(",");
		const cnt = (
			db.query(`SELECT COUNT(*) as cnt FROM users WHERE id IN (${placeholders})`).get(...chunk) as {
				cnt: number;
			}
		).cnt;
		eligible += cnt;
	}
	const skippedMissingUser = primaryMap.size - eligible;

	log(
		`  Checkins: ${eligible} eligible, ${processed} processed, ${skippedMissingUser} skipped (missing user)`,
	);
	return { eligible, processed, skippedMissingUser };
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
		post_comments: 0,
		checkins: 0,
		skipped: {},
		errors: [],
		duration: 0,
	};

	// Resolve source files (split vs legacy format)
	const sources = resolveSourceFiles(config.sourceDir);
	log("Migration starting");
	log(`  Source: ${config.sourceDir} (${sources.format} format)`);
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
		const forumsResult = await migrateForums(loader, sources);
		stats.forums = forumsResult.total;

		const forumThreadTypesResult = await migrateForumThreadTypes(
			loader,
			sources,
			forumsResult.forumTypeConfigs,
		);
		// Tracked under skipped for now to avoid widening the public Stats
		// shape; the count is also visible in the per-step log line.
		stats.skipped.forum_thread_types = forumThreadTypesResult.total;

		// Reviewer pin 3d056b39 #4: dump the synthetic-id mapping for
		// post-dry-run inspection. Includes:
		//   • rows: the exact `forum_thread_types` records inserted, in
		//     mint order (deterministic across runs).
		//   • globalCollisions:
		//       sourceTypeidGlobalDuplicates — source typeids that appear
		//         in 2+ forums (the bug 0039 fixes; 0/1/2 are expected).
		//       syntheticIdAfterMint — synthetic ids that were assigned
		//         to multiple rows (should always be empty; non-empty =
		//         mint regression).
		//       forumSourcePairs — duplicate (forum_id, source_typeid)
		//         pairs that would violate the new UNIQUE INDEX.
		//   • zeroTypeidDefinitions — source_typeid=0 rows we skipped.
		//   • perForumReconciliation — per-fid breakdown so reviewer can
		//     spot-check fid=134 / 147 / 113 against the dump.
		{
			const { writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const ma = forumThreadTypesResult.mappingArtifact;

			// Compute globalCollisions.syntheticIdAfterMint and
			// .forumSourcePairs from the row set itself — defensive
			// integrity check rather than trusting the builder.
			const syntheticIdSeen = new Map<number, number>();
			const pairSeen = new Map<string, number>();
			const syntheticIdDupes: Array<{ id: number; count: number }> = [];
			const pairDupes: Array<{ forum_id: number; source_typeid: number; count: number }> = [];
			for (const r of ma.rows) {
				const id = r.id as number;
				const fid = r.forum_id as number;
				const st = r.source_typeid as number;
				syntheticIdSeen.set(id, (syntheticIdSeen.get(id) ?? 0) + 1);
				const key = `${fid}:${st}`;
				pairSeen.set(key, (pairSeen.get(key) ?? 0) + 1);
			}
			for (const [id, count] of syntheticIdSeen) {
				if (count > 1) syntheticIdDupes.push({ id, count });
			}
			for (const [key, count] of pairSeen) {
				if (count > 1) {
					const [fid, st] = key.split(":").map(Number);
					pairDupes.push({ forum_id: fid as number, source_typeid: st as number, count });
				}
			}
			if (syntheticIdDupes.length > 0) {
				log(
					`  WARN: synthetic id collisions detected post-mint: ${syntheticIdDupes.length} (this is a mint regression — investigate)`,
				);
			}
			if (pairDupes.length > 0) {
				log(
					`  WARN: (forum_id, source_typeid) duplicates detected: ${pairDupes.length} (would violate the 0039 UNIQUE INDEX)`,
				);
			}

			const artifact = {
				generated_at: new Date().toISOString(),
				summary: {
					rows: ma.rows.length,
					forums: ma.perForumReconciliation.length,
					sourceTypeidGlobalDuplicates: ma.sourceTypeidGlobalDuplicates.length,
					zeroTypeidDefinitions: ma.zeroTypeidDefinitions.length,
				},
				rows: ma.rows,
				globalCollisions: {
					sourceTypeidGlobalDuplicates: ma.sourceTypeidGlobalDuplicates,
					syntheticIdAfterMint: syntheticIdDupes,
					forumSourcePairs: pairDupes,
				},
				zeroTypeidDefinitions: ma.zeroTypeidDefinitions,
				perForumReconciliation: ma.perForumReconciliation,
			};
			const artifactPath = join(outputDir, "forum_thread_types_mapping.json");
			writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
			log(`  Mapping artifact: ${artifactPath}`);
		}

		const userResult = await migrateUsers(loader, sources);
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
			sources,
			forumIds,
			userResult.userIds,
			forumThreadTypesResult.forumThreadTypeNameMap,
			forumThreadTypesResult.syntheticIdMap,
		);
		stats.threads = threadResult.total;
		stats.forums += threadResult.missingForums; // placeholder forums
		stats.users += threadResult.missingAuthors; // placeholder users
		stats.skipped.threads = threadResult.skipped;
		stats.skipped.threadMissingForums = threadResult.missingForums;
		stats.skipped.threadMissingAuthors = threadResult.missingAuthors;
		stats.skipped.threadUnmappedTypeids = threadResult.unmappedTypeids.total;
		stats.skipped.threadUnmappedTypeidPairs = threadResult.unmappedTypeids.distinct;

		const postResult = await migratePosts(
			loader,
			sources,
			userResult.userIds,
			threadResult.threadIds,
			logger,
		);
		stats.posts = postResult.total;
		stats.users += postResult.missingAuthors; // placeholder users
		stats.skipped.missingAuthors = postResult.missingAuthors;
		stats.skipped.missingThreads = postResult.missingThreads;

		const attachResult = await migrateAttachments(
			loader,
			sources,
			postResult.postIds,
			threadResult.threadIds,
			logger,
		);
		stats.attachments = attachResult.total;
		stats.threads += attachResult.missingThreads; // placeholder threads
		stats.posts += attachResult.missingPosts; // placeholder posts
		stats.skipped.attachments = attachResult.skipped;
		stats.skipped.attachMissingPosts = attachResult.missingPosts;
		stats.skipped.attachMissingThreads = attachResult.missingThreads;

		// Post comments (after posts/threads/users; placeholders auto-fill missing FKs)
		const pcResult = await migratePostComments(
			loader,
			sources,
			userResult.userIds,
			threadResult.threadIds,
			postResult.postIds,
		);
		stats.post_comments = pcResult.total;
		stats.users += pcResult.missingUsers;
		stats.threads += pcResult.missingThreads;
		stats.posts += pcResult.missingPosts;
		stats.skipped.pcMissingUsers = pcResult.missingUsers;
		stats.skipped.pcMissingThreads = pcResult.missingThreads;
		stats.skipped.pcMissingPosts = pcResult.missingPosts;

		// Checkins (after users, uses WHERE EXISTS)
		const checkinResult = await migrateCheckins(loader, sources);
		stats.checkins = checkinResult.eligible;
		stats.skipped.checkinsMissingUser = checkinResult.skippedMissingUser;

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
			post_comments: stats.post_comments,
			checkins: stats.checkins,
		};

		const intReport = verifyIntegrity(db, expected);
		log(`  Integrity: ${intReport.summary}`);
		if (!intReport.passed) {
			for (const c of intReport.checks.filter((c) => !c.passed)) {
				log(`    FAIL: ${c.name} — expected ${c.expected}, got ${c.actual}`);
			}
			stats.errors.push(`Integrity verification failed: ${intReport.summary}`);
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
	log(`  Post Comments: ${stats.post_comments.toLocaleString()}`);
	log(`  Checkins:    ${stats.checkins.toLocaleString()}`);

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
