#!/usr/bin/env bun
/**
 * Import Messages (Private Messages) to D1
 */

import { batchExecuteD1, getRowCount, verifyTestDb } from "./d1-importer";
import { transformMessages, generateMessagesSQL } from "./transforms/messages";

export async function importTable(
  options: { limit?: number; shards?: number[] } = {}
): Promise<{ success: number; failed: number; total: number }> {
  const { limit, shards } = options;

  console.log("  Transforming messages data...");
  const messages = await transformMessages({ limit, shards });
  console.log(`    Transformed ${messages.length} messages`);

  const statements = generateMessagesSQL(messages);

  console.log("  Importing to D1...");
  const startTime = Date.now();
  const { success, failed } = await batchExecuteD1(statements, {
    tableName: "messages",
    disableForeignKeys: true,
    onProgress: (done, total) => {
      process.stdout.write(
        `\r    Progress: ${done}/${total} (${Math.round((done / total) * 100)}%)`
      );
    },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n    ✅ Imported: ${success} success, ${failed} failed in ${elapsed}s`);

  const count = await getRowCount("messages");
  console.log(`    ✅ Verified: ${count} rows`);

  return { success, failed, total: messages.length };
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined;

  console.log("✉️ Messages Import");
  console.log("=".repeat(50));

  console.log("\n1. Verifying test database...");
  const isTest = await verifyTestDb();
  if (!isTest) {
    console.error("❌ SAFETY CHECK FAILED!");
    process.exit(1);
  }
  console.log("   ✅ Test database confirmed");

  console.log("\n2. Importing messages...");
  const result = await importTable({ limit });

  console.log("\n" + "=".repeat(50));
  console.log(`✨ Messages import complete! (${result.success}/${result.total})`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
}
