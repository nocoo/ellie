/**
 * Posts Table Transform
 *
 * Maps pre_forum_post + pre_forum_post_1~4 to D1 posts table
 * Note: BBCode conversion is deferred - content is stored as-is
 */

import { streamParseMySQLDump, rowsToObjects } from "../stream-parse-dump";

const DUMP_DIR = "reference/db";

interface MySQLPost {
  pid: number;
  tid: number;
  fid: number;
  authorid: number;
  author: string;
  message: string;
  dateline: number;
  first: number;
  position: number;
  invisible: number;
}

interface D1Post {
  id: number;
  thread_id: number;
  forum_id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: number;
  is_first: number;
  position: number;
  invisible: number;
}

/**
 * Transform MySQL posts to D1 format
 * Note: Content is stored as-is (BBCode not converted)
 */
export async function transformPosts(
  options: { limit?: number; offset?: number; shards?: number[] } = {}
): Promise<D1Post[]> {
  const { limit, offset = 0, shards = [0, 1, 2, 3, 4] } = options;

  const result: D1Post[] = [];
  let collected = 0;

  // Process main table and shards
  for (const shard of shards) {
    if (limit && collected >= limit) break;

    const file = shard === 0 ? "post_main.sql.gz" : "post_shards.sql.gz";
    const table = shard === 0 ? "pre_forum_post" : `pre_forum_post_${shard}`;

    console.log(`  Loading ${table}...`);
    const remainingLimit = limit ? limit - collected : undefined;
    const { columns, rows } = await streamParseMySQLDump(`${DUMP_DIR}/${file}`, table, {
      limit: remainingLimit,
      offset: shard === 0 ? offset : 0,
    });
    const posts = rowsToObjects(columns, rows) as MySQLPost[];
    console.log(`    Found ${posts.length} posts`);

    for (const post of posts) {
      if (limit && collected >= limit) break;

      result.push({
        id: post.pid,
        thread_id: post.tid,
        forum_id: post.fid,
        author_id: post.authorid,
        author_name: post.author || "",
        content: post.message || "",
        created_at: post.dateline || 0,
        is_first: post.first || 0,
        position: post.position || 0,
        invisible: post.invisible || 0,
      });
      collected++;
    }
  }

  return result;
}

function escapeString(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "''";
  }
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Generate SQL INSERT statements for posts
 */
export function generatePostsSQL(posts: D1Post[]): string[] {
  const statements: string[] = [];

  for (const p of posts) {
    const sql = `INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES (${p.id}, ${p.thread_id}, ${p.forum_id}, ${p.author_id}, ${escapeString(p.author_name)}, ${escapeString(p.content)}, ${p.created_at}, ${p.is_first}, ${p.position}, ${p.invisible})`;
    statements.push(sql);
  }

  return statements;
}

// CLI for testing
if (import.meta.main) {
  console.log("Transforming posts (limit 100, main table only)...");
  const posts = await transformPosts({ limit: 100, shards: [0] });
  console.log(`\nTransformed ${posts.length} posts`);

  console.log("\nSample (first 3):");
  for (const p of posts.slice(0, 3)) {
    const contentPreview = p.content.slice(0, 50).replace(/\n/g, " ");
    console.log(
      `  [${p.id}] thread=${p.thread_id}, pos=${p.position}: ${contentPreview}...`
    );
  }
}
