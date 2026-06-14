import { describe, expect, test } from "vitest";
import { isReadStatement } from "../../../src/test-support/d1-shim";

describe("isReadStatement", () => {
	test("recognizes SELECT", () => {
		expect(isReadStatement("SELECT 1")).toBe(true);
		expect(isReadStatement("  select * from users  ")).toBe(true);
	});

	test("recognizes WITH (CTE)", () => {
		expect(isReadStatement("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(true);
	});

	test("recognizes EXPLAIN", () => {
		expect(isReadStatement("EXPLAIN QUERY PLAN SELECT 1")).toBe(true);
	});

	test("recognizes RETURNING anywhere", () => {
		expect(isReadStatement("INSERT INTO x VALUES (1) RETURNING id")).toBe(true);
		expect(isReadStatement("DELETE FROM x WHERE id=1 RETURNING *")).toBe(true);
	});

	test("rejects bare INSERT/UPDATE/DELETE", () => {
		expect(isReadStatement("INSERT INTO x (a) VALUES (?)")).toBe(false);
		expect(isReadStatement("UPDATE x SET a=?")).toBe(false);
		expect(isReadStatement("DELETE FROM x")).toBe(false);
	});

	test("rejects DDL", () => {
		expect(isReadStatement("CREATE TABLE x (id INTEGER)")).toBe(false);
		expect(isReadStatement("DROP TABLE x")).toBe(false);
		expect(isReadStatement("ALTER TABLE x ADD COLUMN y INTEGER")).toBe(false);
	});
});
