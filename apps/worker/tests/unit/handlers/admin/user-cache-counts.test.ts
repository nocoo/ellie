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

describe("Admin user list count budget", () => {
	it("does not query message or attachment counts and does not replace them with false zeroes", async () => {
		const prepare = fixture.env.DB.prepare.bind(fixture.env.DB);
		vi.spyOn(fixture.env.DB, "prepare").mockImplementation((sql) => {
			if (/FROM (messages|attachments)\b/i.test(sql)) throw new Error("Unnecessary count query");
			return prepare(sql);
		});
		const loaded = await readAdminEntity<{ items: Record<string, unknown>[] }>(
			fixture.env,
			undefined,
			descriptor,
		);
		expect(loaded.items).toHaveLength(5);
		for (const user of loaded.items) {
			expect(user).not.toHaveProperty("messagesCount");
			expect(user).not.toHaveProperty("attachmentsCount");
		}
		expect(fixture.calls).toHaveLength(2);
		fixture.calls.length = 0;
		expect(await readAdminEntity(fixture.env, undefined, descriptor)).toEqual(loaded);
		expect(fixture.calls).toHaveLength(0);
		expect(fixture.snapshots("admin:entity:list")).toHaveLength(1);
	});

	it("still rejects an unconfirmed user page rather than caching an empty list", async () => {
		fixture.state.queryError = true;
		await expect(readAdminEntity(fixture.env, undefined, descriptor)).rejects.toThrow();
		expect(fixture.snapshots("admin:entity:list")).toHaveLength(0);
		fixture.state.queryError = false;
		const loaded = await readAdminEntity<{ items: unknown[] }>(fixture.env, undefined, descriptor);
		expect(loaded.items).toHaveLength(5);
	});
});
