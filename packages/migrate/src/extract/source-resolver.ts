/**
 * Source file resolver — maps logical dump file names to actual paths.
 *
 * Supports two dump formats:
 *   - "split" (2026-05-09+): per-table files (forums.sql.gz, members.sql.gz, ...)
 *   - "legacy" (2026-04-08): combined files (main_small.sql.gz, user_extra.sql.gz, ...)
 *
 * The resolver checks which files exist and returns resolved paths. Split format
 * is preferred; legacy is used as fallback.
 */

import { existsSync } from "node:fs";

/** Resolved source file paths for the migration pipeline. */
export interface SourceFiles {
	/** Forum tables (pre_forum_forum, pre_forum_forumfield). */
	forums: string;
	/** Attachment tables (pre_forum_attachment, pre_forum_attachment_0..9). */
	attachments: string;
	/** Member tables (pre_common_member, pre_common_member_archive). */
	members: string;
	/** UC center members (uc_members). */
	ucMembers: string;
	/** Member count (pre_common_member_count + archive). */
	memberCount: string;
	/** Usergroup (pre_common_usergroup). */
	usergroup: string;
	/** Member field_forum (pre_common_member_field_forum + archive). */
	memberFieldForum: string;
	/** Member profile (pre_common_member_profile + archive). */
	memberProfile: string;
	/** Member status (pre_common_member_status + archive). */
	memberStatus: string;
	/** Thread tables (pre_forum_thread + shards). */
	threads: string;
	/** Thread shard tables — separate file in legacy, same as threads in split. */
	threadShards: string;
	/** Post tables (pre_forum_post + shards). */
	posts: string;
	/** Post shard tables — separate file in legacy, same as posts in split. */
	postShards: string;
	/** Checkins (pre_dsu_paulsign + pre_dsu_paulsign2). Null if no dump exists. */
	checkins: string | null;
	/** Post comments (pre_forum_postcomment). Null if no dump exists. */
	postcomments: string | null;
	/** Threadtype (pre_forum_threadtype). May not exist in split format. */
	threadtype: string | null;
	/** Detected format. */
	format: "split" | "legacy";
}

/**
 * Resolve a file path, preferring `preferred` over `fallback`.
 * Returns the first existing path, or the preferred path even if missing
 * (so the caller gets a clear error about the expected file).
 */
function resolve(sourceDir: string, preferred: string, fallback: string): string {
	const prefPath = `${sourceDir}/${preferred}`;
	if (existsSync(prefPath)) return prefPath;
	const fbPath = `${sourceDir}/${fallback}`;
	if (existsSync(fbPath)) return fbPath;
	return prefPath; // Return preferred so error messages are clear
}

/** Return the path if it exists, null otherwise. */
function resolveOptional(sourceDir: string, ...names: string[]): string | null {
	for (const name of names) {
		const path = `${sourceDir}/${name}`;
		if (existsSync(path)) return path;
	}
	return null;
}

/**
 * Detect whether a source directory uses split or legacy dump format.
 *
 * Split format indicators: `forums.sql.gz`, `members.sql.gz` exist.
 * Legacy format indicators: `main_small.sql.gz`, `user_extra.sql.gz` exist.
 */
export function detectFormat(sourceDir: string): "split" | "legacy" {
	if (existsSync(`${sourceDir}/forums.sql.gz`) && existsSync(`${sourceDir}/members.sql.gz`)) {
		return "split";
	}
	return "legacy";
}

/**
 * Resolve all source file paths for the migration pipeline.
 *
 * In split format (2026-05-09+):
 *   - Each table group has its own file
 *   - Thread/post shards are in the same file as the main table
 *
 * In legacy format (2026-04-08):
 *   - `main_small.sql.gz` contains forums + attachments + members
 *   - `user_extra.sql.gz` contains member_count + usergroup + field_forum + profile + status + threadtype
 *   - Thread/post shards are in separate files
 */
export function resolveSourceFiles(sourceDir: string): SourceFiles {
	const format = detectFormat(sourceDir);

	if (format === "split") {
		const threads = `${sourceDir}/threads.sql.gz`;
		const posts = `${sourceDir}/posts.sql.gz`;
		return {
			forums: `${sourceDir}/forums.sql.gz`,
			attachments: `${sourceDir}/attachments.sql.gz`,
			members: `${sourceDir}/members.sql.gz`,
			ucMembers: `${sourceDir}/ucenter_members.sql.gz`,
			memberCount: `${sourceDir}/member_count.sql.gz`,
			usergroup: `${sourceDir}/usergroup.sql.gz`,
			memberFieldForum: `${sourceDir}/member_field_forum.sql.gz`,
			memberProfile: `${sourceDir}/member_profile.sql.gz`,
			memberStatus: `${sourceDir}/member_status.sql.gz`,
			threads,
			threadShards: threads, // Shards are in the same file in split format
			posts,
			postShards: posts, // Shards are in the same file in split format
			checkins: resolveOptional(sourceDir, "checkins.sql.gz"),
			postcomments: resolveOptional(sourceDir, "postcomment.sql.gz"),
			threadtype: resolveOptional(sourceDir, "usergroup.sql.gz"),
			format,
		};
	}

	// Legacy format
	const mainSmall = `${sourceDir}/main_small.sql.gz`;
	const userExtra = `${sourceDir}/user_extra.sql.gz`;
	return {
		forums: mainSmall,
		attachments: mainSmall,
		members: mainSmall,
		ucMembers: resolve(sourceDir, "ucenter.sql.gz", "ucenter_members.sql.gz"),
		memberCount: userExtra,
		usergroup: userExtra,
		memberFieldForum: userExtra,
		memberProfile: userExtra,
		memberStatus: userExtra,
		threads: resolve(sourceDir, "thread.sql.gz", "threads.sql.gz"),
		threadShards: resolve(sourceDir, "thread_shards.sql.gz", "threads.sql.gz"),
		posts: resolve(sourceDir, "post_main.sql.gz", "posts.sql.gz"),
		postShards: resolve(sourceDir, "post_shards.sql.gz", "posts.sql.gz"),
		checkins: null, // Legacy format doesn't have checkins
		postcomments: resolveOptional(sourceDir, "postcomment.sql.gz"),
		threadtype: userExtra,
		format,
	};
}
