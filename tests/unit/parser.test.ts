import { describe, expect, test } from "bun:test";
import {
	parseInsertLine,
	parseInsertStatement,
	parseQuotedString,
	parseTuple,
} from "../../scripts/migrate/extract/parser";

describe("parseQuotedString", () => {
	test("simple string", () => {
		const { value, end } = parseQuotedString("'hello'", 0);
		expect(value).toBe("hello");
		expect(end).toBe(7);
	});

	test("empty string", () => {
		const { value, end } = parseQuotedString("''", 0);
		expect(value).toBe("");
		expect(end).toBe(2);
	});

	test("escaped single quote with backslash", () => {
		const { value } = parseQuotedString("'it\\'s'", 0);
		expect(value).toBe("it's");
	});

	test("escaped single quote with double quote", () => {
		const { value } = parseQuotedString("'it''s'", 0);
		expect(value).toBe("it's");
	});

	test("escaped backslash", () => {
		const { value } = parseQuotedString("'a\\\\b'", 0);
		expect(value).toBe("a\\b");
	});

	test("escaped newline", () => {
		const { value } = parseQuotedString("'line1\\nline2'", 0);
		expect(value).toBe("line1\nline2");
	});

	test("escaped carriage return", () => {
		const { value } = parseQuotedString("'line1\\rline2'", 0);
		expect(value).toBe("line1\rline2");
	});

	test("escaped tab", () => {
		const { value } = parseQuotedString("'col1\\tcol2'", 0);
		expect(value).toBe("col1\tcol2");
	});

	test("escaped null byte", () => {
		const { value } = parseQuotedString("'a\\0b'", 0);
		expect(value).toBe("a\0b");
	});

	test("multiple escapes combined", () => {
		const { value } = parseQuotedString("'it\\'s a\\\\b\\ntest'", 0);
		expect(value).toBe("it's a\\b\ntest");
	});

	test("string starting at non-zero offset", () => {
		const { value, end } = parseQuotedString("xxx'hello'yyy", 3);
		expect(value).toBe("hello");
		expect(end).toBe(10);
	});

	test("string with parentheses and commas (tricky for tuple parsing)", () => {
		const { value } = parseQuotedString("'value),(with,commas)'", 0);
		expect(value).toBe("value),(with,commas)");
	});

	test("unknown escape sequence preserved", () => {
		const { value } = parseQuotedString("'test\\xval'", 0);
		expect(value).toBe("testxval");
	});
});

describe("parseTuple", () => {
	test("simple numeric values", () => {
		const { row, end } = parseTuple("1,2,3)", 0);
		expect(row).toEqual(["1", "2", "3"]);
		expect(end).toBe(6);
	});

	test("mixed types: number, string, NULL", () => {
		const { row } = parseTuple("1,'hello',NULL)", 0);
		expect(row).toEqual(["1", "hello", null]);
	});

	test("empty string value", () => {
		const { row } = parseTuple("1,'',3)", 0);
		expect(row).toEqual(["1", "", "3"]);
	});

	test("string with commas inside", () => {
		const { row } = parseTuple("1,'a,b,c',3)", 0);
		expect(row).toEqual(["1", "a,b,c", "3"]);
	});

	test("string with parentheses inside", () => {
		const { row } = parseTuple("1,'a(b)c',3)", 0);
		expect(row).toEqual(["1", "a(b)c", "3"]);
	});

	test("string with ),( inside", () => {
		const { row } = parseTuple("1,'val),(next',3)", 0);
		expect(row).toEqual(["1", "val),(next", "3"]);
	});

	test("all NULLs", () => {
		const { row } = parseTuple("NULL,NULL,NULL)", 0);
		expect(row).toEqual([null, null, null]);
	});

	test("empty tuple", () => {
		const { row } = parseTuple(")", 0);
		expect(row).toEqual([]);
	});

	test("negative number", () => {
		const { row } = parseTuple("-1,'test',0)", 0);
		expect(row).toEqual(["-1", "test", "0"]);
	});

	test("decimal number", () => {
		const { row } = parseTuple("3.14,'pi')", 0);
		expect(row).toEqual(["3.14", "pi"]);
	});
});

describe("parseInsertLine", () => {
	test("single tuple", () => {
		const rows = parseInsertLine(
			"INSERT INTO `users` VALUES (1,'admin','admin@test.com');",
			"users",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(["1", "admin", "admin@test.com"]);
	});

	test("multiple tuples (extended INSERT)", () => {
		const rows = parseInsertLine(
			"INSERT INTO `users` VALUES (1,'alice','a@t.com'),(2,'bob','b@t.com'),(3,'carol','c@t.com');",
			"users",
		);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual(["1", "alice", "a@t.com"]);
		expect(rows[1]).toEqual(["2", "bob", "b@t.com"]);
		expect(rows[2]).toEqual(["3", "carol", "c@t.com"]);
	});

	test("wrong table name returns empty", () => {
		const rows = parseInsertLine("INSERT INTO `posts` VALUES (1,'content');", "users");
		expect(rows).toHaveLength(0);
	});

	test("non-INSERT line returns empty", () => {
		const rows = parseInsertLine("-- this is a comment", "users");
		expect(rows).toHaveLength(0);
	});

	test("tuple with NULL values", () => {
		const rows = parseInsertLine("INSERT INTO `test` VALUES (1,NULL,'text',NULL);", "test");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(["1", null, "text", null]);
	});

	test("tuple with escaped content", () => {
		const rows = parseInsertLine(
			"INSERT INTO `posts` VALUES (1,'it\\'s a \\\"test\\\"','line1\\nline2');",
			"posts",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.[1]).toBe('it\'s a "test"');
		expect(rows[0]?.[2]).toBe("line1\nline2");
	});

	test("tuple with content containing ),( pattern", () => {
		const rows = parseInsertLine(
			"INSERT INTO `posts` VALUES (1,'value),(fake',2),(3,'real',4);",
			"posts",
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual(["1", "value),(fake", "2"]);
		expect(rows[1]).toEqual(["3", "real", "4"]);
	});

	test("real-world DZ member data (from actual dump)", () => {
		const line =
			"INSERT INTO `pre_common_member` VALUES (1,'','同舟共济','41351b8d5de2c653d5f8cb1c85dec559',0,1,0,0,1,1,0,'1',1019145600,70,0,'9999',0,38,0,1,0,0,0);";
		const rows = parseInsertLine(line, "pre_common_member");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.[0]).toBe("1");
		expect(rows[0]?.[2]).toBe("同舟共济");
		expect(rows[0]?.[3]).toBe("41351b8d5de2c653d5f8cb1c85dec559");
		expect(rows[0]?.[8]).toBe("1"); // adminid
	});
});

describe("parseInsertStatement", () => {
	test("multi-line SQL with comments and INSERT", () => {
		const sql = [
			"-- Table: users",
			"INSERT INTO `users` VALUES (1,'alice','a@t.com');",
			"-- more data",
			"INSERT INTO `users` VALUES (2,'bob','b@t.com'),(3,'carol','c@t.com');",
		].join("\n");

		const rows = parseInsertStatement(sql, "users");
		expect(rows).toHaveLength(3);
		expect(rows[0]?.[1]).toBe("alice");
		expect(rows[1]?.[1]).toBe("bob");
		expect(rows[2]?.[1]).toBe("carol");
	});

	test("ignores other tables", () => {
		const sql = [
			"INSERT INTO `posts` VALUES (1,'content');",
			"INSERT INTO `users` VALUES (1,'alice','a@t.com');",
		].join("\n");

		const rows = parseInsertStatement(sql, "users");
		expect(rows).toHaveLength(1);
	});

	test("empty SQL returns empty", () => {
		const rows = parseInsertStatement("", "users");
		expect(rows).toHaveLength(0);
	});
});
