import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../../scripts/migrate/cli";

describe("parseCliArgs", () => {
	test("returns empty config for no args", () => {
		const config = parseCliArgs([]);
		expect(config).toEqual({});
	});

	test("parses --db flag", () => {
		const config = parseCliArgs(["--db", "/tmp/test.db"]);
		expect(config.dbPath).toBe("/tmp/test.db");
	});

	test("parses --source flag", () => {
		const config = parseCliArgs(["--source", "/data/dumps"]);
		expect(config.sourceDir).toBe("/data/dumps");
	});

	test("parses --batch flag as number", () => {
		const config = parseCliArgs(["--batch", "1000"]);
		expect(config.batchSize).toBe(1000);
	});

	test("parses all flags together", () => {
		const config = parseCliArgs(["--db", "output.db", "--source", "./dumps", "--batch", "200"]);
		expect(config.dbPath).toBe("output.db");
		expect(config.sourceDir).toBe("./dumps");
		expect(config.batchSize).toBe(200);
	});

	test("ignores unknown flags", () => {
		const config = parseCliArgs(["--unknown", "value"]);
		expect(config.dbPath).toBeUndefined();
		expect(config.sourceDir).toBeUndefined();
		expect(config.batchSize).toBeUndefined();
	});
});
