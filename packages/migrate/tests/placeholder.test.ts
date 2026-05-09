import { describe, expect, test } from "vitest";
import { TABLE_COLUMNS } from "../src/load/schema";
import { createDeletedUserPlaceholder } from "../src/load/sql-builder";

describe("createDeletedUserPlaceholder", () => {
	test("covers every column in TABLE_COLUMNS.users", () => {
		const placeholder = createDeletedUserPlaceholder(12345);
		const keys = Object.keys(placeholder);

		for (const col of TABLE_COLUMNS.users) {
			expect(keys, `missing column: ${col}`).toContain(col);
		}
	});

	test("has no extra keys beyond TABLE_COLUMNS.users", () => {
		const placeholder = createDeletedUserPlaceholder(12345);
		const validColumns = new Set(TABLE_COLUMNS.users);

		for (const key of Object.keys(placeholder)) {
			expect(validColumns.has(key), `unexpected key: ${key}`).toBe(true);
		}
	});

	test("key count equals TABLE_COLUMNS.users length", () => {
		const placeholder = createDeletedUserPlaceholder(12345);
		expect(Object.keys(placeholder)).toHaveLength(TABLE_COLUMNS.users.length);
	});

	test("sets correct id and username", () => {
		const placeholder = createDeletedUserPlaceholder(99);
		expect(placeholder.id).toBe(99);
		expect(placeholder.username).toBe("[已删除用户99]");
	});

	test("sets status to -3 (placeholder)", () => {
		const placeholder = createDeletedUserPlaceholder(1);
		expect(placeholder.status).toBe(-3);
	});

	test("no values are null", () => {
		const placeholder = createDeletedUserPlaceholder(42);
		for (const [key, value] of Object.entries(placeholder)) {
			expect(value, `${key} should not be null`).not.toBeNull();
		}
	});

	test("coins is 0", () => {
		const placeholder = createDeletedUserPlaceholder(1);
		expect(placeholder.coins).toBe(0);
	});

	test("has_avatar is 0", () => {
		const placeholder = createDeletedUserPlaceholder(1);
		expect(placeholder.has_avatar).toBe(0);
	});
});
