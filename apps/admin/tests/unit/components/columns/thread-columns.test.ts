import { describe, expect, it } from "vitest";
import { buildThreadColumns } from "@/components/admin/columns/thread-columns";

describe("buildThreadColumns", () => {
	it("full variant emits the 8 main-page columns", () => {
		const cols = buildThreadColumns({ variant: "full", forumNameById: () => "版块A" });
		expect(cols.map((c) => c.key)).toEqual([
			"subject",
			"forum",
			"author",
			"replies",
			"views",
			"status",
			"createdAt",
			"lastPost",
		]);
	});

	it("full variant still emits the forum column when forumNameById is omitted", () => {
		// Defensive: the column stays but its cell falls back to `#<id>`;
		// asserted here so a future caller change doesn't accidentally
		// disappear the column when it wanted a fallback instead.
		const cols = buildThreadColumns({ variant: "full" });
		expect(cols.map((c) => c.key)).toContain("forum");
	});

	it("compact variant emits the 5 recent-view columns", () => {
		const cols = buildThreadColumns({ variant: "compact" });
		expect(cols.map((c) => c.key)).toEqual(["subject", "author", "createdAt", "replies", "views"]);
	});

	it("does not emit the actions column in either variant", () => {
		for (const variant of ["full", "compact"] as const) {
			const cols = buildThreadColumns({ variant });
			expect(cols.map((c) => c.key)).not.toContain("actions");
		}
	});
});
