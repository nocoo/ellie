import { describe, expect, it } from "vitest";
import { buildAttachmentColumns } from "@/components/admin/columns/attachment-columns";

describe("buildAttachmentColumns", () => {
	it("default variant includes downloads and uploaders in the shared list columns", () => {
		const cols = buildAttachmentColumns();
		expect(cols.map((c) => c.key)).toEqual([
			"preview",
			"filename",
			"size",
			"downloads",
			"author",
			"thread",
			"createdAt",
		]);
	});

	it("does not emit an actions column", () => {
		const cols = buildAttachmentColumns({ onPreview: () => {} });
		expect(cols.map((c) => c.key)).not.toContain("actions");
	});
});
