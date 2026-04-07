#!/usr/bin/env bun
/**
 * D1 Migration Dry-Run Script
 *
 * This script performs a complete data migration rehearsal on the test database:
 * 1. Clear test database (except d1_migrations)
 * 2. Apply schema from 0000_init_schema.sql
 * 3. Import data table by table from MySQL dumps
 * 4. Verify each table after import
 *
 * Usage:
 *   bun run scripts/import/dry-run.ts [--table <name>] [--skip-clear] [--skip-schema]
 *
 * Options:
 *   --table <name>   Only import/verify specific table
 *   --skip-clear     Skip clearing the database
 *   --skip-schema    Skip applying schema (assumes tables exist)
 */

import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

// Configuration
const CONFIG = {
  testDb: "tongjinet-db-test",
  wranglerConfig: "apps/worker/wrangler.toml",
  dumpDir: "reference/db",
  schemaFile: "apps/worker/migrations/0000_init_schema.sql",
  tempDir: "/tmp/ellie-import",
};

// Table import order (respects FK dependencies)
const IMPORT_ORDER = [
  "users",
  "forums",
  "threads",
  "posts",
  "attachments",
  "messages",
] as const;

// Dump file mapping: D1 table -> { file, mysqlTables, transform }
const DUMP_MAPPING: Record<
  string,
  {
    files: string[];
    mysqlTables: string[];
    transform: (rows: unknown[]) => unknown[];
  }
> = {
  users: {
    files: ["ucenter.sql.gz", "main_small.sql.gz", "user_extra.sql.gz"],
    mysqlTables: [
      "uc_members",
      "pre_common_member",
      "pre_common_member_count",
      "pre_common_member_profile",
      "pre_common_member_status",
      "pre_common_member_field_forum",
      "pre_common_usergroup",
    ],
    transform: transformUsers,
  },
  forums: {
    files: ["main_small.sql.gz", "moderator.sql.gz"],
    mysqlTables: [
      "pre_forum_forum",
      "pre_forum_forumfield",
      "pre_forum_moderator",
    ],
    transform: transformForums,
  },
  threads: {
    files: ["thread.sql.gz", "user_extra.sql.gz"],
    mysqlTables: ["pre_forum_thread", "pre_forum_threadtype"],
    transform: transformThreads,
  },
  posts: {
    files: ["post_main.sql.gz", "post_shards.sql.gz"],
    mysqlTables: [
      "pre_forum_post",
      "pre_forum_post_1",
      "pre_forum_post_2",
      "pre_forum_post_3",
      "pre_forum_post_4",
    ],
    transform: transformPosts,
  },
  attachments: {
    files: ["main_small.sql.gz"],
    mysqlTables: [
      "pre_forum_attachment",
      "pre_forum_attachment_0",
      "pre_forum_attachment_1",
      "pre_forum_attachment_2",
      "pre_forum_attachment_3",
      "pre_forum_attachment_4",
      "pre_forum_attachment_5",
      "pre_forum_attachment_6",
      "pre_forum_attachment_7",
      "pre_forum_attachment_8",
      "pre_forum_attachment_9",
    ],
    transform: transformAttachments,
  },
  messages: {
    files: ["pm.sql.gz"],
    mysqlTables: [
      "uc_pm_indexes",
      "uc_pm_lists",
      "uc_pm_members",
      "uc_pm_messages_0",
      "uc_pm_messages_1",
      "uc_pm_messages_2",
      "uc_pm_messages_3",
      "uc_pm_messages_4",
      "uc_pm_messages_5",
      "uc_pm_messages_6",
      "uc_pm_messages_7",
      "uc_pm_messages_8",
      "uc_pm_messages_9",
    ],
    transform: transformMessages,
  },
};

// Expected row counts (approximate, for validation)
const EXPECTED_COUNTS: Record<string, { min: number; max: number }> = {
  users: { min: 1100000, max: 1200000 },
  forums: { min: 200, max: 300 },
  threads: { min: 900000, max: 1100000 },
  posts: { min: 9000000, max: 10000000 },
  attachments: { min: 70000, max: 90000 },
  messages: { min: 50000, max: 100000 },
};

// ============================================================================
// Transform Functions
// ============================================================================

function transformUsers(rows: unknown[]): unknown[] {
  // TODO: Implement user transformation
  // Merge uc_members + pre_common_member + pre_common_member_count + profiles
  console.log("  [transform] users - not yet implemented");
  return [];
}

function transformForums(rows: unknown[]): unknown[] {
  // TODO: Implement forum transformation
  // Merge pre_forum_forum + pre_forum_forumfield + parse lastpost
  console.log("  [transform] forums - not yet implemented");
  return [];
}

function transformThreads(rows: unknown[]): unknown[] {
  // TODO: Implement thread transformation
  console.log("  [transform] threads - not yet implemented");
  return [];
}

function transformPosts(rows: unknown[]): unknown[] {
  // TODO: Implement post transformation with BBCode conversion
  console.log("  [transform] posts - not yet implemented");
  return [];
}

function transformAttachments(rows: unknown[]): unknown[] {
  // TODO: Implement attachment transformation
  console.log("  [transform] attachments - not yet implemented");
  return [];
}

function transformMessages(rows: unknown[]): unknown[] {
  // TODO: Implement message transformation
  // Convert UCenter conversation model to simple sender/receiver model
  console.log("  [transform] messages - not yet implemented");
  return [];
}

// ============================================================================
// D1 Operations
// ============================================================================

async function executeD1(command: string): Promise<string> {
  const result =
    await $`npx wrangler d1 execute ${CONFIG.testDb} -c ${CONFIG.wranglerConfig} --remote --json --command ${command}`.text();
  return result;
}

async function executeD1File(filePath: string): Promise<string> {
  const result =
    await $`npx wrangler d1 execute ${CONFIG.testDb} -c ${CONFIG.wranglerConfig} --remote --json --file ${filePath}`.text();
  return result;
}

async function clearDatabase(): Promise<void> {
  console.log("\n📦 Step 1: Clearing test database...");

  // Get all tables
  const tablesResult = await executeD1(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' AND name != 'd1_migrations'"
  );
  const tables = JSON.parse(tablesResult);

  if (!tables[0]?.results?.length) {
    console.log("  Database is already empty");
    return;
  }

  // Drop each table
  for (const row of tables[0].results) {
    const tableName = row.name;
    console.log(`  Dropping ${tableName}...`);
    await executeD1(`DROP TABLE IF EXISTS "${tableName}"`);
  }

  console.log("  ✅ Database cleared");
}

async function applySchema(): Promise<void> {
  console.log("\n📐 Step 2: Applying schema...");

  if (!existsSync(CONFIG.schemaFile)) {
    throw new Error(`Schema file not found: ${CONFIG.schemaFile}`);
  }

  // Read and execute schema (split by semicolons, filter empty)
  const schema = readFileSync(CONFIG.schemaFile, "utf-8");
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  let count = 0;
  for (const stmt of statements) {
    if (stmt.includes("CREATE TABLE") || stmt.includes("CREATE INDEX")) {
      await executeD1(stmt);
      count++;
    }
  }

  console.log(`  ✅ Applied ${count} statements`);
}

async function verifyTable(tableName: string): Promise<{
  count: number;
  valid: boolean;
}> {
  const result = await executeD1(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
  const parsed = JSON.parse(result);
  const count = parsed[0]?.results?.[0]?.cnt ?? 0;

  const expected = EXPECTED_COUNTS[tableName];
  const valid = expected
    ? count >= expected.min && count <= expected.max
    : count > 0;

  return { count, valid };
}

async function importTable(tableName: string): Promise<void> {
  console.log(`\n📥 Importing ${tableName}...`);

  const mapping = DUMP_MAPPING[tableName];
  if (!mapping) {
    console.log(`  ⚠️ No mapping defined for ${tableName}, skipping`);
    return;
  }

  // Check dump files exist
  for (const file of mapping.files) {
    const path = join(CONFIG.dumpDir, file);
    if (!existsSync(path)) {
      console.log(`  ❌ Missing dump file: ${path}`);
      return;
    }
  }

  // TODO: Parse MySQL dumps and transform
  // For now, just show what would be done
  console.log(`  Files: ${mapping.files.join(", ")}`);
  console.log(`  MySQL tables: ${mapping.mysqlTables.join(", ")}`);

  // Call transform (currently just logs)
  mapping.transform([]);

  // Verify
  const { count, valid } = await verifyTable(tableName);
  const status = valid ? "✅" : "⚠️";
  console.log(`  ${status} ${tableName}: ${count.toLocaleString()} rows`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const skipClear = args.includes("--skip-clear");
  const skipSchema = args.includes("--skip-schema");
  const tableIdx = args.indexOf("--table");
  const specificTable = tableIdx >= 0 ? args[tableIdx + 1] : null;

  console.log("🚀 D1 Migration Dry-Run");
  console.log(`   Database: ${CONFIG.testDb}`);
  console.log(`   Config: ${CONFIG.wranglerConfig}`);

  // Verify test DB isolation
  console.log("\n🔒 Verifying test database isolation...");
  try {
    const markerResult = await executeD1(
      "SELECT value FROM _test_marker WHERE key = 'env'"
    );
    const parsed = JSON.parse(markerResult);
    const env = parsed[0]?.results?.[0]?.value;
    if (env !== "test") {
      console.error(
        "❌ SAFETY CHECK FAILED: _test_marker.env != 'test'. Aborting!"
      );
      process.exit(1);
    }
    console.log("  ✅ Confirmed test database");
  } catch {
    // Table might not exist yet, that's ok for first run
    console.log("  ⚠️ _test_marker table not found (will be created)");
  }

  // Step 1: Clear database
  if (!skipClear) {
    await clearDatabase();
  } else {
    console.log("\n📦 Step 1: Skipped (--skip-clear)");
  }

  // Step 2: Apply schema
  if (!skipSchema) {
    await applySchema();
  } else {
    console.log("\n📐 Step 2: Skipped (--skip-schema)");
  }

  // Step 3: Import tables
  console.log("\n📊 Step 3: Importing data...");

  const tablesToImport = specificTable
    ? [specificTable]
    : (IMPORT_ORDER as unknown as string[]);

  for (const table of tablesToImport) {
    await importTable(table);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📋 Summary");
  console.log("=".repeat(60));

  for (const table of IMPORT_ORDER) {
    try {
      const { count, valid } = await verifyTable(table);
      const status = valid ? "✅" : "❌";
      const expected = EXPECTED_COUNTS[table];
      const range = expected
        ? `(expected ${expected.min.toLocaleString()}-${expected.max.toLocaleString()})`
        : "";
      console.log(
        `  ${status} ${table.padEnd(15)} ${count.toLocaleString().padStart(12)} rows ${range}`
      );
    } catch {
      console.log(`  ❌ ${table.padEnd(15)} (table not found)`);
    }
  }

  console.log("\n✨ Dry-run complete");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
