/**
 * Step-by-step migration runner — one table at a time.
 *
 * Usage:
 *   bun run scripts/migrate/run-step.ts forums
 *   bun run scripts/migrate/run-step.ts users
 *   bun run scripts/migrate/run-step.ts threads
 *   bun run scripts/migrate/run-step.ts posts
 *   bun run scripts/migrate/run-step.ts attachments
 *
 * Each step appends to the same DB (output/ellie.db).
 * Run in order: forums → users → threads → posts → attachments.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolveSourceFiles } from "./extract/source-resolver";
import {
	migrateAttachments,
	migrateCheckins,
	migrateForums,
	migratePosts,
	migrateThreads,
	migrateUsers,
} from "./index";
import { BatchLoader } from "./load/batch-insert";
import { MigrationLogger } from "./load/logger";

const SOURCE_DIR = process.argv[3] ?? "reference/db";
const DB_PATH = "output/ellie.db";
const OUTPUT_DIR = "output";
const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 10000;

const step = process.argv[2];
if (!step) {
	console.error(
		"Usage: bun run scripts/migrate/run-step.ts <forums|users|threads|posts|attachments|checkins> [sourceDir]",
	);
	process.exit(1);
}

const sources = resolveSourceFiles(SOURCE_DIR);

mkdirSync(OUTPUT_DIR, { recursive: true });

const logger = new MigrationLogger({ outputDir: OUTPUT_DIR });
// Only init log files on first step (forums), otherwise append
if (step === "forums" || !existsSync(`${OUTPUT_DIR}/migration.log`)) {
	logger.init();
}

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

const loader = new BatchLoader({
	dbPath: DB_PATH,
	batchSize: BATCH_SIZE,
	progressInterval: PROGRESS_INTERVAL,
	onProgress: (table, count) => {
		log(`  [${table}] ${count.toLocaleString()} rows...`);
	},
});

const startTime = Date.now();

try {
	// Create tables if DB is new
	if (!existsSync(DB_PATH) || step === "forums") {
		log("Creating tables...");
		loader.createTables();
	}

	switch (step) {
		case "forums": {
			const count = await migrateForums(loader, sources);
			log(`Done. Forums: ${count}`);

			// Quick verification
			const db = loader.getDb();
			const dbCount = db.query("SELECT COUNT(*) as c FROM forums").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM forums = ${dbCount.c}`);

			// Sample data
			const samples = db.query("SELECT id, name, threads, posts FROM forums LIMIT 5").all();
			log("Sample forums:");
			for (const row of samples) {
				const r = row as { id: number; name: string; threads: number; posts: number };
				log(`  [${r.id}] ${r.name} — ${r.threads} threads, ${r.posts} posts`);
			}
			break;
		}

		case "users": {
			const result = await migrateUsers(loader, sources);
			log(`Done. Users: ${result.total}`);

			const db = loader.getDb();
			const dbCount = db.query("SELECT COUNT(*) as c FROM users").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM users = ${dbCount.c}`);

			// Status distribution
			const statuses = db
				.query("SELECT status, COUNT(*) as c FROM users GROUP BY status ORDER BY c DESC")
				.all() as Array<{ status: number; c: number }>;
			log("User status distribution:");
			for (const s of statuses) {
				const label =
					s.status === 0
						? "active"
						: s.status === -1
							? "banned"
							: s.status === -2
								? "archived"
								: `status=${s.status}`;
				log(`  ${label}: ${s.c.toLocaleString()}`);
			}

			// Role distribution
			const roles = db
				.query("SELECT role, COUNT(*) as c FROM users GROUP BY role ORDER BY c DESC")
				.all() as Array<{ role: number; c: number }>;
			log("User role distribution:");
			for (const r of roles) {
				log(`  role=${r.role}: ${r.c.toLocaleString()}`);
			}

			// Sample with avatar
			const withAvatar = db.query("SELECT COUNT(*) as c FROM users WHERE avatar != ''").get() as {
				c: number;
			};
			log(`Users with avatar: ${withAvatar.c}`);
			break;
		}

		case "threads": {
			const db = loader.getDb();

			log("Loading forumIds from DB...");
			const forumRows = db.query("SELECT id FROM forums").all() as Array<{ id: number }>;
			const forumIds = new Set(forumRows.map((r) => r.id));
			log(`  ${forumIds.size.toLocaleString()} forum IDs loaded`);

			log("Loading userIds from DB...");
			const userRowsT = db.query("SELECT id FROM users").all() as Array<{ id: number }>;
			const userIdsT = new Set(userRowsT.map((r) => r.id));
			log(`  ${userIdsT.size.toLocaleString()} user IDs loaded`);

			const result = await migrateThreads(loader, sources, forumIds, userIdsT);
			log(`Done. Threads: ${result.total} inserted, ${result.skipped} skipped`);
			log(`  Missing forums (placeholders created): ${result.missingForums}`);
			log(`  Missing authors (placeholders created): ${result.missingAuthors}`);

			const dbCount = db.query("SELECT COUNT(*) as c FROM threads").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM threads = ${dbCount.c}`);

			// Check FK: all forum_ids should exist in forums (should be 0 now)
			const orphanForums = db
				.query("SELECT COUNT(*) as c FROM threads WHERE forum_id NOT IN (SELECT id FROM forums)")
				.get() as { c: number };
			log(`FK check: threads.forum_id orphans = ${orphanForums.c}`);

			// Sticky distribution
			const stickies = db
				.query("SELECT sticky, COUNT(*) as c FROM threads GROUP BY sticky ORDER BY sticky")
				.all() as Array<{ sticky: number; c: number }>;
			log("Thread sticky distribution:");
			for (const s of stickies) {
				log(`  sticky=${s.sticky}: ${s.c.toLocaleString()}`);
			}
			break;
		}

		case "posts": {
			// Need userIds and threadIds — read from existing DB
			const db = loader.getDb();

			log("Loading userIds from DB...");
			const userRows = db.query("SELECT id FROM users").all() as Array<{ id: number }>;
			const userIds = new Set(userRows.map((r) => r.id));
			log(`  ${userIds.size.toLocaleString()} user IDs loaded`);

			log("Loading threadIds from DB...");
			const threadRows = db.query("SELECT id FROM threads").all() as Array<{ id: number }>;
			const threadIds = new Set(threadRows.map((r) => r.id));
			log(`  ${threadIds.size.toLocaleString()} thread IDs loaded`);

			const result = await migratePosts(loader, sources, userIds, threadIds, logger);
			log(`Done. Posts: ${result.total} inserted`);
			log(`  Encoding repaired: ${result.encodingRepaired}`);
			log(`  BBCode failures: ${result.bbcodeFailures}`);
			log(`  Missing authors (placeholders created): ${result.missingAuthors}`);
			log(`  Missing threads (placeholders created): ${result.missingThreads}`);

			const dbCount = db.query("SELECT COUNT(*) as c FROM posts").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM posts = ${dbCount.c}`);

			// Invisible distribution
			const invisibles = db
				.query("SELECT invisible, COUNT(*) as c FROM posts GROUP BY invisible ORDER BY c DESC")
				.all() as Array<{ invisible: number; c: number }>;
			log("Post invisible distribution:");
			for (const inv of invisibles) {
				log(`  invisible=${inv.invisible}: ${inv.c.toLocaleString()}`);
			}

			// Sample post content
			const sample = db
				.query("SELECT id, content FROM posts WHERE content != '' LIMIT 3")
				.all() as Array<{ id: number; content: string }>;
			log("Sample posts:");
			for (const p of sample) {
				log(`  [${p.id}] ${p.content.slice(0, 120)}...`);
			}
			break;
		}

		case "attachments": {
			// Need postIds and threadIds from existing DB
			const db = loader.getDb();

			log("Loading postIds from DB...");
			const postRows = db.query("SELECT id FROM posts").all() as Array<{ id: number }>;
			const postIds = new Set(postRows.map((r) => r.id));
			log(`  ${postIds.size.toLocaleString()} post IDs loaded`);

			log("Loading threadIds from DB...");
			const threadRowsA = db.query("SELECT id FROM threads").all() as Array<{ id: number }>;
			const threadIdsA = new Set(threadRowsA.map((r) => r.id));
			log(`  ${threadIdsA.size.toLocaleString()} thread IDs loaded`);

			const result = await migrateAttachments(loader, sources, postIds, threadIdsA, logger);
			log(`Done. Attachments: ${result.total} inserted`);
			log(`  No-index skipped: ${result.skipped}`);
			log(`  Missing posts (placeholders created): ${result.missingPosts}`);
			log(`  Missing threads (placeholders created): ${result.missingThreads}`);

			const dbCount = db.query("SELECT COUNT(*) as c FROM attachments").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM attachments = ${dbCount.c}`);

			// Image vs non-image
			const images = db
				.query("SELECT is_image, COUNT(*) as c FROM attachments GROUP BY is_image")
				.all() as Array<{ is_image: number; c: number }>;
			log("Attachment types:");
			for (const img of images) {
				log(`  is_image=${img.is_image}: ${img.c.toLocaleString()}`);
			}
			break;
		}

		case "checkins": {
			const result = await migrateCheckins(loader, sources);
			log(
				`Done. Checkins: ${result.total} inserted, ${result.skippedMissingUser} skipped (missing user)`,
			);

			const db = loader.getDb();
			const dbCount = db.query("SELECT COUNT(*) as c FROM user_checkins").get() as { c: number };
			log(`Verify: SELECT COUNT(*) FROM user_checkins = ${dbCount.c}`);

			// Top checkers
			const top = db
				.query("SELECT user_id, total_days FROM user_checkins ORDER BY total_days DESC LIMIT 5")
				.all() as Array<{ user_id: number; total_days: number }>;
			log("Top checkers:");
			for (const t of top) {
				log(`  user_id=${t.user_id}: ${t.total_days} days`);
			}
			break;
		}

		default:
			console.error(`Unknown step: ${step}`);
			console.error("Valid steps: forums, users, threads, posts, attachments, checkins");
			process.exit(1);
	}
} catch (err) {
	const msg = err instanceof Error ? err.message : String(err);
	log(`ERROR: ${msg}`);
	if (err instanceof Error && err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
} finally {
	loader.close();
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
log(`Step "${step}" completed in ${elapsed}s`);
