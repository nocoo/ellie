// tests/e2e/bdd/fixtures.ts — BDD L3 共享 fixtures
// Ref: docs/23-l3-bdd-refactor.md §2.4 / §2.6
//
// 继承 ../fixtures/base.ts 的 navigateTo / loginAs / cached storageState，
// 并补一个 emptyDataGate 用于替换防御性 `.isVisible().catch(() => false)`。
//
// BDD spec 文件应从这里 import { test, expect }，而非从 @playwright/test 或
// ../fixtures/base.ts 直接 import，便于后续在此处统一扩展 fixture 行为。

import { test as baseTest, expect } from "../fixtures/base";

/**
 * Inspect a count from a locator/query result and decide whether the
 * surrounding test should be skipped due to missing seed data.
 *
 * Usage:
 *   const count = await page.locator(".post-list .post").count();
 *   const gate = emptyDataGate(count, "posts");
 *   test.skip(gate.skip, gate.reason);
 *
 * The split (return struct, caller calls test.skip) keeps Playwright's static
 * skip-detection happy and makes the skip reason explicit at the call site.
 */
export function emptyDataGate(count: number, what: string): { skip: boolean; reason: string } {
	return count === 0
		? { skip: true, reason: `Test DB has no ${what}; seed required.` }
		: { skip: false, reason: "" };
}

export { baseTest as test, expect };
