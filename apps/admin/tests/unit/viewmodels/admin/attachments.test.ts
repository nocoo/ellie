import { describe, expect, it } from "vitest";
import { buildAttachmentSearchParams, formatFileSize } from "@/viewmodels/admin/attachments";

describe("attachments", () => {
	describe("buildAttachmentSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildAttachmentSearchParams({ page: 1, limit: 20 });
			expect(params.page).toBe(1);
			expect(params.limit).toBe(20);
		});

		it("includes postId when set", () => {
			const params = buildAttachmentSearchParams({ postId: 100 });
			expect(params.postId).toBe(100);
		});

		it("omits undefined postId", () => {
			const params = buildAttachmentSearchParams({});
			expect(params.postId).toBeUndefined();
		});

		it("includes isImage boolean", () => {
			const params = buildAttachmentSearchParams({ isImage: true });
			expect(params.isImage).toBe(true);
		});

		it("omits undefined isImage", () => {
			const params = buildAttachmentSearchParams({});
			expect(params.isImage).toBeUndefined();
		});
	});

	describe("formatFileSize", () => {
		it("returns 0 B for 0", () => {
			expect(formatFileSize(0)).toBe("0 B");
		});

		it("returns B for small values", () => {
			expect(formatFileSize(500)).toBe("500 B");
		});

		it("returns KB for 1024", () => {
			expect(formatFileSize(1024)).toBe("1 KB");
		});

		it("returns MB for 1048576", () => {
			expect(formatFileSize(1048576)).toBe("1 MB");
		});

		it("returns fractional KB", () => {
			expect(formatFileSize(1536)).toBe("1.5 KB");
		});

		it("returns GB for large values", () => {
			expect(formatFileSize(1073741824)).toBe("1 GB");
		});
	});
});
