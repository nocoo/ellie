import { describe, expect, it } from "vitest";
import { memoryFlushSink, todayVisitsMemory } from "../../../../src/lib/analytics/flushSink-memory";
import type { AggregateRow } from "../../../../src/lib/analytics/types";
import { memoryFixture } from "../../../analytics-memory-fixture";
import { makeEnv } from "../../../helpers";

function sample(overrides: Partial<AggregateRow> = {}): AggregateRow {
	return {
		dateLocal: "2026-09-19",
		pathKind: "thread",
		targetId: 1,
		userId: 0,
		botClass: "human",
		count: 2,
		firstSeenAt: 100,
		lastSeenAt: 200,
		...overrides,
	};
}

describe("ephemeral shared visit counters", () => {
	it("merges independent Worker batches, bot classes and labels without persistence", async () => {
		const { env, storage } = memoryFixture();
		await memoryFlushSink(env, [
			sample(),
			sample({ botClass: "bot_search", count: 3, firstSeenAt: 50 }),
		]);
		await memoryFlushSink({ ...env }, [
			sample({ pathKind: "forum", count: 4 }),
			sample({ botClass: "bot_other" }),
			sample({ botClass: "unknown" }),
		]);
		const actor = todayVisitsMemory(env, "2026-09-19");
		expect(await actor.kpi("2026-09-19")).toMatchObject({
			totalViews: 13,
			humanViews: 6,
			botSearchViews: 3,
			botOtherViews: 2,
			unknownViews: 2,
			distinctTargets: 2,
			activeUsers: null,
		});
		expect(await actor.list("thread", 1, 1)).toMatchObject({
			total: 1,
			rows: [{ views: 9, firstSeenAt: 50, lastSeenAt: 200, uniqueUsers: null }],
		});
		expect((await actor.list(null, 2, 1)).rows[0].pathKind).toBe("forum");
		expect(storage.put).not.toHaveBeenCalled();
		expect(storage.sql.exec).not.toHaveBeenCalled();
	});
	it("keeps Shanghai days separate and starts empty after eviction", async () => {
		const { env, instances } = memoryFixture();
		await memoryFlushSink(env, [sample(), sample({ dateLocal: "2026-09-20", count: 7 })]);
		expect((await todayVisitsMemory(env, "2026-09-19").kpi("2026-09-19")).totalViews).toBe(2);
		expect((await todayVisitsMemory(env, "2026-09-20").kpi("2026-09-20")).totalViews).toBe(7);
		instances.clear();
		expect((await todayVisitsMemory(env, "2026-09-19").kpi("2026-09-19")).totalViews).toBe(0);
	});
	it("bounds target cardinality and reports dropped traffic", async () => {
		const { env } = memoryFixture();
		await memoryFlushSink(
			env,
			Array.from({ length: 20_001 }, (_, targetId) => sample({ targetId })),
		);
		const actor = todayVisitsMemory(env, "2026-09-19");
		expect(await actor.kpi("2026-09-19")).toMatchObject({
			distinctTargets: 20_000,
			droppedViews: 2,
		});
		await memoryFlushSink(env, [sample()]);
		expect((await actor.list(null, 1, 1)).rows[0]).toMatchObject({ targetId: 1, views: 4 });
	});
	it("does nothing for empty batches and fails explicitly without a binding", async () => {
		const { env, getByName } = memoryFixture();
		await memoryFlushSink(env, []);
		expect(getByName).not.toHaveBeenCalled();
		await expect(memoryFlushSink(makeEnv(), [sample()])).rejects.toThrow("not configured");
	});
});
