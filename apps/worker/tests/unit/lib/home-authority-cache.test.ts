import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHomeForumRows } from "../../../src/lib/home-authority-cache";
import { loadHomeAuthority } from "../../../src/lib/home-read";
import { readingFixture } from "./cache/thread-cache-fixture";

describe("revision-keyed home authority", () => {
	let f: ReturnType<typeof readingFixture>;
	afterEach(() => f?.close());
	const open = () => (f = readingFixture());
	const revision = () =>
		(
			f.sqlite.prepare("SELECT revision FROM forum_authority_revision").get() as {
				revision: string;
			}
		).revision;

	it("reads one D1 row and zero KV on hot requests; a cold isolate restores KV", async () => {
		open();
		const rows = await loadHomeForumRows(f.env);
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		vi.mocked(f.env.KV.put).mockClear();
		expect(await loadHomeForumRows(f.env)).toEqual(rows);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toContain("WHERE id = 1");
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		f.calls.length = 0;
		expect(await loadHomeForumRows({ ...f.env, DB: { ...f.env.DB } })).toEqual(rows);
		expect(f.calls).toHaveLength(1);
		expect(f.env.KV.get).toHaveBeenCalledTimes(1);
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});

	it("accepts the historical zero forum without treating root groups as topic cards", async () => {
		open();
		f.insert("forums", { id: 0, parent_id: 0, name: "Legacy global" });
		f.insert("forums", { id: 4, parent_id: 1, name: "Card" });
		const cold = await loadHomeAuthority(f.env, null);
		expect(cold.allowedForumIds).toEqual([0, 1, 4]);
		expect(cold.summaryForumIds).toEqual([4]);
		const restored = await loadHomeAuthority({ ...f.env, DB: { ...f.env.DB } }, null);
		expect(restored.summaryForumIds).toEqual([4]);
		expect(restored.allowedForumIds).toEqual(cold.allowedForumIds);
	});

	it("invalidates on gate and structural writes but not counters, names or no-op updates", () => {
		open();
		const original = revision();
		f.sqlite.exec("UPDATE forums SET name = 'Renamed', threads = threads + 1, status = status");
		expect(revision()).toBe(original);
		for (const sql of [
			"UPDATE forums SET visibility = 'members' WHERE id = 1",
			"UPDATE forums SET status = 0 WHERE id = 1",
			"UPDATE forums SET parent_id = 2 WHERE id = 1",
			"UPDATE forums SET type = 'sub' WHERE id = 1",
			"INSERT INTO forums (id, name) VALUES (4, 'New')",
			"UPDATE forums SET id = 5 WHERE id = 4",
			"DELETE FROM forums WHERE id = 5",
		]) {
			const before = revision();
			f.sqlite.exec(sql);
			expect(revision()).not.toBe(before);
		}
	});

	it("rolls back permission and revision changes together", () => {
		open();
		const before = revision();
		f.sqlite.exec("BEGIN; UPDATE forums SET visibility = 'admin' WHERE id = 1;");
		expect(revision()).not.toBe(before);
		f.sqlite.exec("ROLLBACK");
		expect(revision()).toBe(before);
		expect(f.sqlite.prepare("SELECT visibility FROM forums WHERE id = 1").get()?.visibility).toBe(
			"public",
		);
	});

	it("rejects replayed KV after ancestor revocation, even if invalidation writes fail", async () => {
		open();
		f.insert("forums", { id: 4, name: "Child", parent_id: 1 });
		expect((await loadHomeAuthority(f.env, null)).allowedForumIds).toEqual([1, 4]);
		const old = [...f.values.values()][0];
		f.sqlite.exec("UPDATE forums SET visibility = 'admin' WHERE id = 1");
		vi.mocked(f.env.KV.get).mockResolvedValue(old);
		f.state.writeError = true;
		expect((await loadHomeAuthority(f.env, null)).allowedForumIds).toEqual([]);
	});

	it("labels a cold rebuild with its transactional revision after a concurrent change", async () => {
		open();
		const oldRevision = revision();
		let changed = false;
		f.state.afterRead = async (sql) => {
			if (sql.includes("forum_authority_revision") && !changed) {
				changed = true;
				f.sqlite.exec("UPDATE forums SET visibility = 'admin' WHERE id = 1");
			}
		};
		expect((await loadHomeAuthority(f.env, null)).allowedForumIds).toEqual([]);
		expect(f.values.has(`home:authority:v1:${oldRevision}`)).toBe(false);
		expect(f.values.has(`home:authority:v1:${revision()}`)).toBe(true);
	});

	it("rebuilds corrupt KV, tolerates KV outages and never caches failed D1 reads", async () => {
		open();
		vi.mocked(f.env.KV.get).mockResolvedValue(
			JSON.stringify({ createdAt: Date.now(), data: { revision: revision(), rows: [null] } }),
		);
		f.state.queryError = true;
		await expect(loadHomeForumRows(f.env)).rejects.toThrow("Home forums");
		expect(f.env.KV.put).not.toHaveBeenCalled();
		f.state.queryError = false;
		vi.mocked(f.env.KV.get).mockRejectedValue(new Error("KV unavailable"));
		f.state.writeError = true;
		expect(await loadHomeForumRows(f.env)).toHaveLength(3);
	});

	it("fails closed on a missing revision, including with a warm memory snapshot", async () => {
		open();
		await loadHomeForumRows(f.env);
		f.sqlite.exec("DELETE FROM forum_authority_revision");
		await expect(loadHomeForumRows(f.env)).rejects.toThrow("revision could not be loaded");
	});
});
