import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let fixture: ReturnType<typeof readingFixture>;
const descriptor = {
	family: "admin:entity:list",
	params: { entity: "users", query: "limit=20&page=1" },
	scope: "admin",
};

beforeEach(() => {
	fixture = readingFixture();
	fixture.insert("messages", {
		sender_id: 10,
		sender_name: "alice",
		receiver_id: 20,
		receiver_name: "bob",
		content: "Counted message",
		created_at: 1,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	fixture.close();
});

describe("Admin user list aggregate confirmation", () => {
	it.each(["SELECT sender_id AS uid", "SELECT receiver_id AS uid", "SELECT author_id AS uid"])(
		"does not publish false zero counts when %s fails",
		async (failedQuery) => {
			const prepare = fixture.env.DB.prepare.bind(fixture.env.DB);
			const spy = vi.spyOn(fixture.env.DB, "prepare").mockImplementation((sql) => {
				const statement = prepare(sql);
				if (!sql.includes(failedQuery)) return statement;
				return {
					...statement,
					bind: (...args: Parameters<D1PreparedStatement["bind"]>) => {
						const bound = statement.bind(...args);
						return {
							...bound,
							all: async () => ({ ...(await bound.all()), success: false, results: [] }),
						} as unknown as D1PreparedStatement;
					},
				};
			});

			await expect(readAdminEntity(fixture.env, undefined, descriptor)).rejects.toThrow(
				"Admin user message and attachment counts could not be loaded",
			);
			expect(fixture.snapshots("admin:entity:list")).toEqual([]);

			spy.mockRestore();
			const loaded = await readAdminEntity<{ items: { id: number; messagesCount: number }[] }>(
				fixture.env,
				undefined,
				descriptor,
			);
			expect(
				loaded.items
					.filter((user) => user.id === 10 || user.id === 20)
					.map((user) => user.messagesCount),
			).toEqual([1, 1]);
			const coldQueries = fixture.calls.length;
			expect(await readAdminEntity(fixture.env, undefined, descriptor)).toEqual(loaded);
			expect(fixture.calls).toHaveLength(coldQueries);
			expect(fixture.snapshots("admin:entity:list")).toHaveLength(1);
		},
	);
});
