#!/usr/bin/env bun
/**
 * Import Posts to D1
 *
 * Uses streaming parser to handle large dump files (924MB compressed)
 *
 * Usage:
 *   bun run scripts/import/import-posts.ts [--limit N] [--shard N]
 */

import { batchExecuteD1, getRowCount, verifyTestDb } from "./d1-importer";
import { transformPosts, generatePostsSQL } from "./transforms/posts";

/**
 * Import posts table (can be called from full-migration.ts)
 */
export async function importTable(
  options: { limit?: number; shards?: number[] } = {}
): Promise<{ success: number; failed: number; total: number }> {
  const { limit, shards } = options;

  console.log("  Transforming posts data...");
  const posts = await transformPosts({ limit, shards });
  console.log(`    Transformed ${posts.length} posts`);

  const statements = generatePostsSQL(posts);

  console.log("  Importing to D1...");
  const startTime = Date.now();
  const { success, failed } = await batchExecuteD1(statements, {
    tableName: "posts",
    disableForeignKeys: true,
    onProgress: (done, total) => {
      process.stdout.write(
        `\r    Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`
      );
    },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n    ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

  const count = await getRowCount("posts");
  console.log(`    ✅ Verified: ${count} rows`);

  return { success, failed, total: posts.length };
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined;

  const shardIdx = args.indexOf("--shard");
  const shard = shardIdx >= 0 ? parseInt(args[shardIdx + 1]) : undefined;
  const shards = shard !== undefined ? [shard] : undefined;

  console.log("📝 Posts Import");
  console.log("=".repeat(50));

  console.log("\n1. Verifying test database...");
  const isTest = await verifyTestDb();
  if (!isTest) {
    console.error("❌ SAFETY CHECK FAILED!");
    process.exit(1);
  }
  console.log("   ✅ Test database confirmed");

  console.log("\n2. Importing posts...");
  const result = await importTable({ limit, shards });

  console.log("\n" + "=".repeat(50));
  console.log(`✨ Posts import complete! (${result.success}/${result.total})`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
}
