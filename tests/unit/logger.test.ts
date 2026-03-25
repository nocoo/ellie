import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { MigrationLogger } from "../../scripts/migrate/load/logger";

const TEST_DIR = "/tmp/ellie-test-logger";

function cleanup() {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe("MigrationLogger", () => {
	afterEach(cleanup);

	test("init creates log files with headers", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const logger = new MigrationLogger({ outputDir: TEST_DIR });
		logger.init();

		expect(existsSync(`${TEST_DIR}/migration.log`)).toBe(true);
		expect(existsSync(`${TEST_DIR}/bbcode_failures.log`)).toBe(true);
		expect(existsSync(`${TEST_DIR}/encoding_failures.log`)).toBe(true);

		const content = readFileSync(`${TEST_DIR}/migration.log`, "utf-8");
		expect(content).toContain("# Migration orphan log");
	});

	test("logOrphan appends to migration.log", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const logger = new MigrationLogger({ outputDir: TEST_DIR });
		logger.init();

		logger.logOrphan("post", 100, 999, "thread_id not found");
		logger.logOrphan("attachment", 200, 888, "post_id not found");

		const content = readFileSync(`${TEST_DIR}/migration.log`, "utf-8");
		expect(content).toContain("post\t100\t999\tthread_id not found");
		expect(content).toContain("attachment\t200\t888\tpost_id not found");
	});

	test("logBbcodeFailure appends to bbcode_failures.log", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const logger = new MigrationLogger({ outputDir: TEST_DIR });
		logger.init();

		logger.logBbcodeFailure(42, "unclosed tag");
		const content = readFileSync(`${TEST_DIR}/bbcode_failures.log`, "utf-8");
		expect(content).toContain("42\tunclosed tag");
	});

	test("logEncodingFailure appends to encoding_failures.log", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const logger = new MigrationLogger({ outputDir: TEST_DIR });
		logger.init();

		logger.logEncodingFailure(77, "unfixable GBK");
		const content = readFileSync(`${TEST_DIR}/encoding_failures.log`, "utf-8");
		expect(content).toContain("77\tunfixable GBK");
	});

	test("getCounts returns correct totals", () => {
		mkdirSync(TEST_DIR, { recursive: true });
		const logger = new MigrationLogger({ outputDir: TEST_DIR });
		logger.init();

		logger.logOrphan("post", 1, 2, "reason");
		logger.logOrphan("post", 3, 4, "reason");
		logger.logBbcodeFailure(5, "err");
		logger.logEncodingFailure(6, "issue");

		const counts = logger.getCounts();
		expect(counts.orphans).toBe(2);
		expect(counts.bbcodeFailures).toBe(1);
		expect(counts.encodingFailures).toBe(1);
	});
});
