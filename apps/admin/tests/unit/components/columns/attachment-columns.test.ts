import { describe, expect, it } from "vitest";
import { buildAttachmentColumns } from "@/components/admin/columns/attachment-columns";

describe("buildAttachmentColumns", () => {
	it("default variant emits the 5 recent-view columns", () => {
		const cols = buildAttachmentColumns();
		expect(cols.map((c) => c.key)).toEqual(["preview", "filename", "size", "thread", "createdAt"]);
	});

	it("does not emit an actions column", () => {
		const cols = buildAttachmentColumns({ onPreview: () => {} });
		expect(cols.map((c) => c.key)).not.toContain("actions");
	});
});
