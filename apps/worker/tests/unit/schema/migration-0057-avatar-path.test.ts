import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	new URL("../../../migrations/0057_avatar_path_only.sql", import.meta.url),
	"utf8",
);

describe("avatar path-only schema", () => {
	it("removes obsolete columns without changing explicit paths or user identity", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				CREATE TABLE users (
					id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
					avatar TEXT NOT NULL DEFAULT '', has_avatar INTEGER NOT NULL DEFAULT 0,
					avatar_path TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 0
				);
				INSERT INTO users VALUES
					(1, 'legacy', 'obsolete', 1, 'avatar/000/00/00/01_avatar_big.jpg', 0),
					(2, 'modern', '', 1, 'avatars/unique.jpg', 0),
					(3, 'absent', '', 1, '', 0);
			`);
			db.exec(migration);
			expect(
				db
					.prepare("PRAGMA table_info(users)")
					.all()
					.map((row) => row.name),
			).toEqual(["id", "username", "avatar_path", "status"]);
			expect(db.prepare("SELECT id, avatar_path FROM users ORDER BY id").all()).toEqual([
				{ id: 1, avatar_path: "avatar/000/00/00/01_avatar_big.jpg" },
				{ id: 2, avatar_path: "avatars/unique.jpg" },
				{ id: 3, avatar_path: "" },
			]);
			expect(() => db.exec("UPDATE users SET has_avatar = 1")).toThrow();
			expect(() => db.exec("INSERT INTO users (id, username) VALUES (4, 'legacy')")).toThrow();
			const plan = db
				.prepare(
					"EXPLAIN QUERY PLAN SELECT id FROM users WHERE avatar_path = ? AND avatar_path != '' AND id != ? LIMIT 1",
				)
				.all("avatars/unique.jpg", 1);
			expect(plan.some((row) => String(row.detail).includes("idx_users_avatar_path"))).toBe(true);
			expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
		} finally {
			db.close();
		}
	});
});
