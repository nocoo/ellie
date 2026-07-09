import { describe, expect, it } from "vitest";
import { buildPostColumns } from "@/components/admin/columns/post-columns";

describe("buildPostColumns", () => {
	it("default variant emits the 4 recent-view columns", () => {
		const cols = buildPostColumns();
		expect(cols.map((c) => c.key)).toEqual(["content", "author", "thread", "createdAt"]);
	});

	it("does not emit an actions column", () => {
		// Recent's PostsTab today splices its own Trash2 actions column.
		const cols = buildPostColumns();
		expect(cols.map((c) => c.key)).not.toContain("actions");
	});
});
