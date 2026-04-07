/**
 * Forums Table Transform
 *
 * Maps MySQL pre_forum_forum + pre_forum_forumfield + pre_forum_moderator to D1 forums table
 */

import { parseMySQLDump, rowsToObjects } from "../parse-dump";

interface MySQLForum {
  fid: number;
  fup: number;
  type: string;
  name: string;
  status: number;
  displayorder: number;
  threads: number;
  posts: number;
  lastpost: string; // format: "tid\tsubject\ttimestamp\tposter"
  moderators?: string;
}

interface MySQLForumField {
  fid: number;
  description: string;
  icon: string;
}

interface MySQLModerator {
  uid: number;
  fid: number;
  displayorder: number;
  inherited: number;
}

interface D1Forum {
  id: number;
  parent_id: number;
  name: string;
  description: string;
  icon: string;
  display_order: number;
  threads: number;
  posts: number;
  type: string;
  status: number;
  last_thread_id: number;
  last_post_at: number;
  last_poster: string;
  last_thread_subject: string;
  moderators: string;
  last_poster_id: number;
  moderator_ids: string;
  visibility: string;
}

const DUMP_DIR = "reference/db";

/**
 * Parse lastpost field: "tid\tsubject\ttimestamp\tposter"
 */
function parseLastPost(lastpost: string): {
  lastThreadId: number;
  lastThreadSubject: string;
  lastPostAt: number;
  lastPoster: string;
} {
  if (!lastpost || lastpost === "") {
    return {
      lastThreadId: 0,
      lastThreadSubject: "",
      lastPostAt: 0,
      lastPoster: "",
    };
  }

  const parts = lastpost.split("\t");
  return {
    lastThreadId: parseInt(parts[0], 10) || 0,
    lastThreadSubject: parts[1] || "",
    lastPostAt: parseInt(parts[2], 10) || 0,
    lastPoster: parts[3] || "",
  };
}

/**
 * Transform MySQL forums to D1 format
 */
export async function transformForums(): Promise<D1Forum[]> {
  console.log("  Loading pre_forum_forum...");
  const { columns: forumCols, rows: forumRows } = parseMySQLDump(
    `${DUMP_DIR}/main_small.sql.gz`,
    "pre_forum_forum"
  );
  const forums = rowsToObjects(forumCols, forumRows) as MySQLForum[];
  console.log(`    Found ${forums.length} forums`);

  console.log("  Loading pre_forum_forumfield...");
  const { columns: fieldCols, rows: fieldRows } = parseMySQLDump(
    `${DUMP_DIR}/main_small.sql.gz`,
    "pre_forum_forumfield"
  );
  const fields = rowsToObjects(fieldCols, fieldRows) as MySQLForumField[];
  console.log(`    Found ${fields.length} forum fields`);

  // Create field lookup
  const fieldMap = new Map<number, MySQLForumField>();
  for (const field of fields) {
    fieldMap.set(field.fid, field);
  }

  console.log("  Loading pre_forum_moderator...");
  const { columns: modCols, rows: modRows } = parseMySQLDump(
    `${DUMP_DIR}/moderator.sql.gz`,
    "pre_forum_moderator"
  );
  const moderators = rowsToObjects(modCols, modRows) as MySQLModerator[];
  console.log(`    Found ${moderators.length} moderator assignments`);

  // Create moderator lookup: fid -> [uid, uid, ...]
  const modMap = new Map<number, number[]>();
  for (const mod of moderators) {
    const existing = modMap.get(mod.fid) || [];
    existing.push(mod.uid);
    modMap.set(mod.fid, existing);
  }

  // Transform
  const result: D1Forum[] = [];
  for (const forum of forums) {
    const field = fieldMap.get(forum.fid);
    const mods = modMap.get(forum.fid) || [];
    const lastPost = parseLastPost(forum.lastpost);

    result.push({
      id: forum.fid,
      parent_id: forum.fup,
      name: forum.name,
      description: field?.description || "",
      icon: field?.icon || "",
      display_order: forum.displayorder,
      threads: forum.threads,
      posts: forum.posts,
      type: forum.type,
      status: forum.status,
      last_thread_id: lastPost.lastThreadId,
      last_post_at: lastPost.lastPostAt,
      last_poster: lastPost.lastPoster,
      last_thread_subject: lastPost.lastThreadSubject,
      moderators: forum.moderators || "",
      last_poster_id: 0, // Will be computed later from users table
      moderator_ids: mods.join(","),
      visibility: "public", // Default, can be updated later
    });
  }

  return result;
}

/**
 * Generate SQL INSERT statements for forums
 */
export function generateForumsSQL(forums: D1Forum[]): string[] {
  const statements: string[] = [];

  for (const forum of forums) {
    const sql = `INSERT INTO forums (id, parent_id, name, description, icon, display_order, threads, posts, type, status, last_thread_id, last_post_at, last_poster, last_thread_subject, moderators, last_poster_id, moderator_ids, visibility) VALUES (${forum.id}, ${forum.parent_id}, ${escapeString(forum.name)}, ${escapeString(forum.description)}, ${escapeString(forum.icon)}, ${forum.display_order}, ${forum.threads}, ${forum.posts}, ${escapeString(forum.type)}, ${forum.status}, ${forum.last_thread_id}, ${forum.last_post_at}, ${escapeString(forum.last_poster)}, ${escapeString(forum.last_thread_subject)}, ${escapeString(forum.moderators)}, ${forum.last_poster_id}, ${escapeString(forum.moderator_ids)}, ${escapeString(forum.visibility)})`;
    statements.push(sql);
  }

  return statements;
}

function escapeString(value: string): string {
  if (value === null || value === undefined) {
    return "''";
  }
  // Escape single quotes by doubling them (SQLite style)
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

// CLI for testing
if (import.meta.main) {
  console.log("Transforming forums...");
  const forums = await transformForums();
  console.log(`\nTransformed ${forums.length} forums`);

  // Show sample
  console.log("\nSample (first 3):");
  for (const forum of forums.slice(0, 3)) {
    console.log(
      `  [${forum.id}] ${forum.name} (${forum.type}, parent=${forum.parent_id}, threads=${forum.threads})`
    );
    if (forum.moderator_ids) {
      console.log(`      moderator_ids: ${forum.moderator_ids}`);
    }
  }

  // Generate SQL sample
  console.log("\nSQL sample (first 2):");
  const sql = generateForumsSQL(forums.slice(0, 2));
  for (const stmt of sql) {
    console.log(`  ${stmt.slice(0, 200)}...`);
  }
}
